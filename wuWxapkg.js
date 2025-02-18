const wu = require("./wuLib.js");
const wuJs = require("./wuJs.js");
const wuCfg = require("./wuConfig.js");
const wuMl = require("./wuWxml.js");
const wuSs = require("./wuWxss.js");
const path = require("path");
const fs = require("fs");

function header(buf) {
    console.log("\nHeader info:");
    let firstMark = buf.readUInt8(0);
    console.log("  firstMark: 0x%s", firstMark.toString(16));
    let unknownInfo = buf.readUInt32BE(1);
    console.log("  unknownInfo: ", unknownInfo);
    let infoListLength = buf.readUInt32BE(5);
    console.log("  infoListLength: ", infoListLength);
    let dataLength = buf.readUInt32BE(9);
    console.log("  dataLength: ", dataLength);
    let lastMark = buf.readUInt8(13);
    console.log("  lastMark: 0x%s", lastMark.toString(16));
    if (firstMark != 0xbe || lastMark != 0xed) throw Error("Magic number is not correct!");
    return [infoListLength, dataLength];
}

function genList(buf) {
    console.log("\nFile list info:");
    let fileCount = buf.readUInt32BE(0);
    console.log("  fileCount: ", fileCount);
    let fileInfo = [], off = 4;
    for (let i = 0; i < fileCount; i++) {
        let info = {};
        let nameLen = buf.readUInt32BE(off);
        off += 4;
        info.name = buf.toString('utf8', off, off + nameLen);
        off += nameLen;
        info.off = buf.readUInt32BE(off);
        off += 4;
        info.size = buf.readUInt32BE(off);
        off += 4;
        fileInfo.push(info);
    }
    return fileInfo;
}

function saveFile(dir, buf, list) {
    console.log("保存文件...");
    // 遍历文件信息列表list
    for (let info of list) {
        let filePath = path.resolve(dir, (info.name.startsWith("/") ? "." : "") + info.name); // 获取文件路径
        let data = buf.slice(info.off, info.off + info.size); // 获取文件数据
        let fileExtension = path.extname(filePath).toLowerCase(); // 获取文件扩展名并转换为小写
        let fileContent;
        try {
            if (fileExtension === '.json') {
                fileContent = JSON.stringify(JSON.parse(data.toString()), null, 2); // JSON格式化，缩进2个空格
            }  else if (fileExtension === '.txt') {
                fileContent = data.toString().replace(/\r\n|\n|\r/g, '\n'); // Only normalize line endings for .txt
            } else if (fileExtension === '.html' || fileExtension === '.xml' || fileExtension === '.css' || fileExtension === '.js') {
                // try {
                //     const dom = new JSDOM(data.toString()); // 使用 JSDOM 创建虚拟 DOM
                //     const document = parse(dom.window.document.documentElement.innerHTML); // 使用 node-html-parser 解析 HTML
                //     fileContent = document.toString(); // 格式化后的 HTML 字符串
                // } catch (parseError) {
                //     console.error(`如果解析失败，则使用原始数据 ${filePath} 时出错:`, parseError); // 记录错误信息
                //     // console.log(`原始数据: ${data.toString()}`); // 记录原始数据
                    fileContent = data.toString(); // 如果解析失败，则使用原始数据

                // }
            }  else if (fileExtension === '.jpg' || fileExtension === '.png' || fileExtension === '.jpeg' || fileExtension === '.gif' || fileExtension === '.bmp') {
                fileContent = data; // 二进制文件，不需要格式化
            } else {
                fileContent = data.toString(); // 默认处理为纯文本
            }

            // 对于wxml和html文件，进行格式化处理
            if (fileExtension === '.wxml' || fileExtension === '.html') {
                try {
                    // 确保fileContent是字符串
                    let htmlContent = fileContent;
                    if (Buffer.isBuffer(fileContent)) {
                        htmlContent = fileContent.toString('utf8');
                    }
                    
                    // 检查内容是否为有效的字符串
                    if (typeof htmlContent === 'string' && htmlContent.trim()) {
                        const beautify = require('js-beautify').html;
                        fileContent = beautify(htmlContent, {
                            indent_size: 2,
                            wrap_line_length: 80,
                            preserve_newlines: true,
                            max_preserve_newlines: 2,
                            unformatted: ['code', 'pre', 'em', 'strong', 'span'],
                            extra_liners: ['head', 'body', '/html']
                        });
                    } else {
                        console.warn(`跳过格式化: ${filePath} (内容为空或无效)`);
                    }
                } catch (e) {
                    console.error(`格式化文件失败: ${filePath}`, e);
                    // 发生错误时使用原始内容
                    if (Buffer.isBuffer(fileContent)) {
                        fileContent = fileContent.toString('utf8');
                    }
                }
            }

            // 尝试使用wu.save；如果失败，则回退到fs。
            try {
                wu.save(filePath, Buffer.from(fileContent)); // 使用wu.save保存文件
            } catch (wuSaveError) {
                console.error(`wu.save 针对 ${filePath} 失败:`, wuSaveError); // 记录wu.save的错误
                fs.writeFileSync(filePath, fileContent); // 回退到fs进行保存
            }

        } catch (error) {
            console.error(`处理文件 ${filePath} 时出错:`, error); // 记录错误
            //  考虑在此处进行更复杂的错误处理（例如，将错误记录到文件中）
        }
    }
}

function packDone(dir, cb, order) {
    console.log("Unpack done.");
    let weappEvent = new wu.CntEvent, needDelete = {};
    weappEvent.encount(4);
    weappEvent.add(() => {
        wu.addIO(() => {
            console.log("Split and make up done.");
            if (!order.includes("d")) {
                console.log("Delete files...");
                wu.addIO(() => console.log("Deleted.\n\nFile done."));
                for (let name in needDelete) if (needDelete[name] >= 8) wu.del(name);
            }
            cb();
        });
    });

    function doBack(deletable) {
        for (let key in deletable) {
            if (!needDelete[key]) needDelete[key] = 0;
            needDelete[key] += deletable[key];//all file have score bigger than 8 will be delete.
        }
        weappEvent.decount();
    }

    function dealThreeThings(dir, mainDir, nowDir) {
        console.log("Split app-service.js and make up configs & wxss & wxml & wxs...");

        //deal config
        if (fs.existsSync(path.resolve(dir, "app-config.json"))) {
            wuCfg.doConfig(path.resolve(dir, "app-config.json"), doBack);
            console.log('deal config ok');
        }
        //deal js
        if (fs.existsSync(path.resolve(dir, "app-service.js"))) {
            wuJs.splitJs(path.resolve(dir, "app-service.js"), doBack, mainDir);
            console.log('deal js ok');
        }
        if (fs.existsSync(path.resolve(dir, "workers.js"))) {
            wuJs.splitJs(path.resolve(dir, "workers.js"), doBack, mainDir);
            console.log('deal js2 ok');
        }
        //deal html
        if (mainDir) {
            if (fs.existsSync(path.resolve(dir, "page-frame.js"))) {
                wuMl.doFrame(path.resolve(dir, "page-frame.js"), doBack, order, mainDir);
                console.log('deal sub html ok');
            }
            wuSs.doWxss(dir, doBack, mainDir, nowDir);
        } else {
            if (fs.existsSync(path.resolve(dir, "page-frame.html"))) {
                wuMl.doFrame(path.resolve(dir, "page-frame.html"), doBack, order, mainDir);
                console.log('deal html ok');
            } else if (fs.existsSync(path.resolve(dir, "app-wxss.js"))) {
                wuMl.doFrame(path.resolve(dir, "app-wxss.js"), doBack, order, mainDir);
                if (!needDelete[path.resolve(dir, "page-frame.js")]) {
                    needDelete[path.resolve(dir, "page-frame.js")] = 8;
                }
                console.log('deal wxss.js ok');
            } else {
                throw Error("page-frame-like file is not found in the package by auto.");
            }
            //Force it run at last, becuase lots of error occured in this part
            wuSs.doWxss(dir, doBack);

            console.log('deal css ok');
        }

    }

//This will be the only func running this time, so async is needless.
    if (fs.existsSync(path.resolve(dir, "app-service.js"))) {
        //weapp
        dealThreeThings(dir);
    } else if (fs.existsSync(path.resolve(dir, "game.js"))) {
        //wegame
        console.log("Split game.js and rewrite game.json...");
        let gameCfg = path.resolve(dir, "app-config.json");
        wu.get(gameCfg, cfgPlain => {
            let cfg = JSON.parse(cfgPlain);
            if (cfg.subContext) {
                console.log("Found subContext, splitting it...")
                delete cfg.subContext;
                let contextPath = path.resolve(dir, "subContext.js");
                wuJs.splitJs(contextPath, () => wu.del(contextPath));
            }
            wu.save(path.resolve(dir, "game.json"), JSON.stringify(cfg, null, 4));
            wu.del(gameCfg);
        });
        wuJs.splitJs(path.resolve(dir, "game.js"), () => {
            wu.addIO(() => {
                console.log("Split and rewrite done.");
                cb();
            });
        });
    } else {//分包
        let doSubPkg = false;
        for (const orderElement of order) {
            if (orderElement.indexOf('s=') !== -1) {
                let mainDir = orderElement.substring(2, orderElement.length);
                console.log("now dir: " + dir);
                console.log("param of mainDir: " + mainDir);

                let findDir = function (dir, oldDir) {
                    let files = fs.readdirSync(dir);
                    for (const file of files) {
                        let workDir = path.join(dir, file);
                        if (fs.existsSync(path.resolve(workDir, "app-service.js"))) {
                            console.log("sub package word dir: " + workDir);
                            mainDir = path.resolve(oldDir, mainDir);
                            console.log("real mainDir: " + mainDir);
                            dealThreeThings(workDir, mainDir, oldDir);
                            doSubPkg = true;
                            return true;
                        } else {
                            findDir(workDir, oldDir);
                        }
                    }

                };

                findDir(dir, dir);

            }
        }
        if (!doSubPkg) {
            throw new Error("检测到此包是分包后的子包, 请通过 -s 参数指定存放路径后重试, 如 node wuWxapkg.js -s=/xxx/xxx ./testpkg/test-pkg-sub.wxapkg");
        }
    }
}

function doFile(name, cb, order) {
    // 遍历order数组，如果元素以"s="开头，则将其后面的部分赋值给全局变量global.subPack
    for (let ord of order) if (ord.startsWith("s=")) global.subPack = ord.slice(3);
    console.log("解包文件 " + name + "...");
    // 获取文件解压后的目录路径，该路径为wxapkg文件所在目录的父目录下，并以wxapkg文件名（不含扩展名）命名
    let dir = path.resolve(name, "..", path.basename(name, ".wxapkg"));
    wu.get(name, buf => { // 使用wu.get异步获取文件内容
        // 从缓冲区的前14个字节读取文件信息列表长度和数据长度
        let [infoListLength, dataLength] = header(buf.slice(0, 14)); 
        // 如果order数组包含"o"元素，则表示需要在解包完成后打印"Unpack done."，否则调用packDone函数处理后续操作
        if (order.includes("o")) wu.addIO(console.log.bind(console), "Unpack done.");
        else wu.addIO(packDone, dir, cb, order);
        // 保存解压后的文件，dir为保存目录，buf为文件缓冲区，genList(buf.slice(14, infoListLength + 14))生成文件列表
        saveFile(dir, buf, genList(buf.slice(14, infoListLength + 14)));
    }, {});
}

module.exports = {doFile: doFile};
if (require.main === module) {
    wu.commandExecute(doFile, "Unpack a wxapkg file.\n\n[-o] [-d] [-s=<Main Dir>] <files...>\n\n-d Do not delete transformed unpacked files.\n-o Do not execute any operation after unpack.\n-s=<Main Dir> Regard all packages provided as subPackages and\n              regard <Main Dir> as the directory of sources of the main package.\n<files...> wxapkg files to unpack");
}
