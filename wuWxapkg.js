const wu = require("./wuLib.js");
const wuJs = require("./wuJs.js");
const wuCfg = require("./wuConfig.js");
const wuMl = require("./wuWxml.js");
const wuSs = require("./wuWxss.js");
const path = require("path");
const fs = require("fs");
const beautify = require('js-beautify');
const prettier = require('prettier');

// 添加日志功能
function createLogger(logPath) {
    // 确保日志目录存在
    if (!fs.existsSync(logPath)) {
        fs.mkdirSync(logPath, { recursive: true });
    }
    
    const logFile = path.join(logPath, 'wxappUnpacker.log');
    
    return {
        log: function(...args) {
            try {
                const message = args.map(arg => 
                    typeof arg === 'object' ? JSON.stringify(arg) : arg
                ).join(' ');
                const timestamp = new Date().toISOString();
                const logMessage = `[${timestamp}] INFO: ${message}\n`;
                
                fs.appendFileSync(logFile, logMessage);
                console.log(message);
            } catch (error) {
                console.error('日志写入失败:', error);
            }
        },
        
        error: function(...args) {
            try {
                const message = args.map(arg => 
                    typeof arg === 'object' ? JSON.stringify(arg) : arg
                ).join(' ');
                const timestamp = new Date().toISOString();
                const logMessage = `[${timestamp}] ERROR: ${message}\n`;
                
                fs.appendFileSync(logFile, logMessage);
                console.error(message);
            } catch (error) {
                console.error('错误日志写入失败:', error);
            }
        }
    };
}

function header(buf) {
    const logger = createLogger(path.dirname(process.argv[2]));
    logger.log("\n文件头信息:");
    let firstMark = buf.readUInt8(0);
    logger.log("  firstMark: 0x%s", firstMark.toString(16));
    let unknownInfo = buf.readUInt32BE(1);
    logger.log("  unknownInfo: ", unknownInfo);
    let infoListLength = buf.readUInt32BE(5);
    logger.log("  infoListLength: ", infoListLength);
    let dataLength = buf.readUInt32BE(9);
    logger.log("  dataLength: ", dataLength);
    let lastMark = buf.readUInt8(13);
    logger.log("  lastMark: 0x%s", lastMark.toString(16));
    if (firstMark != 0xbe || lastMark != 0xed) {
        logger.error("Magic number 不正确!");
        throw Error("Magic number 不正确!");
    }
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

function beautifyJsCode(code) {
    try {
        return beautify.js(code, {
            indent_size: 2,
            space_in_empty_paren: true,
            preserve_newlines: true,
            max_preserve_newlines: 2,
            break_chained_methods: false,
            keep_array_indentation: false,
            unescape_strings: false,
            wrap_line_length: 80
        });
    } catch (e) {
        console.error('JS 格式化失败:', e);
        return code;
    }
}

function deobfuscateVariableNames(code) {
    // 常见的方法名映射
    const methodNameMap = {
        'onLaunch': 'onLaunch',
        'onShow': 'onShow',
        'onHide': 'onHide',
        'onError': 'onError',
        'onPageNotFound': 'onPageNotFound',
        'onUnhandledRejection': 'onUnhandledRejection',
        'onLoad': 'onLoad',
        'onReady': 'onReady',
        'onUnload': 'onUnload',
        'onPullDownRefresh': 'onPullDownRefresh',
        'onReachBottom': 'onReachBottom',
        'onShareAppMessage': 'onShareAppMessage',
        'onPageScroll': 'onPageScroll',
        'onResize': 'onResize',
        'onTabItemTap': 'onTabItemTap'
    };

    let deobfuscatedCode = code;

    // 替换混淆的方法名
    Object.entries(methodNameMap).forEach(([original, readable]) => {
        const pattern = new RegExp(`["']${original}["']\\s*:`, 'g');
        deobfuscatedCode = deobfuscatedCode.replace(pattern, `${readable}:`);
    });

    return deobfuscatedCode;
}

async function saveFile(dir, buf, list) {
    const logger = createLogger(dir);
    logger.log("开始保存文件...");
    
    let processedFiles = 0;
    const totalFiles = list.length;
    
    for (let info of list) {
        try {
            let filePath = path.resolve(dir, (info.name.startsWith("/") ? "." : "") + info.name);
            filePath = filePath.replace(/\\/g, '/');
            
            let data = buf.slice(info.off, info.off + info.size);
            if (!data || data.length === 0) {
                logger.error(`文件数据为空: ${info.name}`);
                continue;
            }
            
            // 确保目标目录存在
            const fileDir = path.dirname(filePath);
            if (!fs.existsSync(fileDir)) {
                fs.mkdirSync(fileDir, { recursive: true });
            }
            
            // 处理文件内容
            const fileExtension = path.extname(filePath).toLowerCase();
            let fileContent;
            
            try {
                // 同步处理不同类型的文件
                switch(fileExtension) {
                    case '.js':
                        fileContent = handleJsFile(info, data, filePath);
                        break;
                    case '.json':
                        fileContent = handleJsonFile(data);
                        break;
                    case '.wxml':
                    case '.html':
                        fileContent = handleWxmlFile(data);
                        break;
                    case '.wxss':
                    case '.css':
                        fileContent = handleWxssFile(data);
                        break;
                    case '.svg':
                        // 直接保存原始数据
                        fileContent = data;
                        break;
                    default:
                        fileContent = handleDefaultFile(data, fileExtension);
                }

                // 确保文件内容不为空且不是Promise
                if (!fileContent) {
                    throw new Error('文件内容为空');
                }

                // 如果不是Buffer，转换为Buffer
                const contentToSave = Buffer.isBuffer(fileContent) ? 
                    fileContent : 
                    Buffer.from(typeof fileContent === 'string' ? fileContent : String(fileContent));
                
                // 同步写入文件
                fs.writeFileSync(filePath, contentToSave);
                processedFiles++;
                logger.log(`进度: ${processedFiles}/${totalFiles} - 已保存: ${info.name}`);
                
            } catch (processError) {
                logger.error(`处理文件内容失败 ${info.name}: ${processError.message}`);
                // 保存原始数据作为备份
                const backupPath = `${filePath}.backup`;
                fs.writeFileSync(backupPath, data);
                logger.log(`已创建备份文件: ${backupPath}`);
            }
            
        } catch (error) {
            logger.error(`处理文件失败: ${info.name}`, error);
        }
    }
    
    logger.log(`文件保存完成: 成功处理 ${processedFiles}/${totalFiles} 个文件`);
}

// 新增：处理JS文件
function handleJsFile(info, data, filePath) {
    try {
        let jsContent = data.toString('utf-8');
        
        // 特殊处理 app-service.js
        if (info.name.includes('app-service.js')) {
            jsContent = deobfuscateVariableNames(jsContent);
            jsContent = handleAppServiceJs(jsContent);
        }
        
        // 使用 js-beautify 格式化 JS 代码
        return beautify.js(jsContent, {
            indent_size: 2,
            space_in_empty_paren: true,
            preserve_newlines: true,
            max_preserve_newlines: 2,
            keep_array_indentation: false,
            break_chained_methods: false,
            indent_scripts: 'normal',
            brace_style: 'collapse,preserve-inline',
            space_before_conditional: true,
            unescape_strings: false,
            jslint_happy: false,
            end_with_newline: true,
            wrap_line_length: 80,
            indent_inner_html: true,
            comma_first: false,
            e4x: true
        });
    } catch (error) {
        console.error('JS 格式化失败:', error);
        return data.toString('utf-8');
    }
}

// 新增：处理 app-service.js 的特殊逻辑
function handleAppServiceJs(content) {
    try {
        // 解析模块定义
        const modulePattern = /define\("([^"]+)",\s*function\s*\(require,\s*module,\s*exports,\s*window,\s*document,\s*frames,\s*self\)\s*{([\s\S]+?})\);/g;
        let matches = content.matchAll(modulePattern);
        
        let processedContent = content;
        for (const match of matches) {
            const modulePath = match[1];
            const moduleCode = match[2];
            
            // 处理每个模块
            processedContent = processModuleCode(processedContent, modulePath, moduleCode);
        }
        
        return processedContent;
    } catch (error) {
        console.error('处理 app-service.js 失败:', error);
        return content;
    }
}

// 新增：处理模块代码
function processModuleCode(content, modulePath, moduleCode) {
    try {
        // 1. 处理模块路径
        const normalizedPath = modulePath.replace(/\\/g, '/');
        
        // 2. 处理模块内容
        let processedCode = moduleCode
            // 处理常见的混淆模式
            .replace(/([a-zA-Z$_][a-zA-Z0-9$_]*)\["([a-zA-Z$_][a-zA-Z0-9$_]*)"\]/g, '$1.$2')
            // 处理函数名混淆
            .replace(/function\s+([a-zA-Z$_][a-zA-Z0-9$_]*)\s*\(/g, function(match, name) {
                return `function ${deobfuscateFunctionName(name)}(`;
            });
            
        return content.replace(moduleCode, processedCode);
    } catch (error) {
        console.error(`处理模块 ${modulePath} 失败:`, error);
        return content;
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
    console.log("解包文件 " + name + "...");
    const dir = path.resolve(name, "..", path.basename(name, ".wxapkg"));
    
    // 确保输出目录存在
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    
    try {
        wu.get(name, async (buf) => {
            const [infoListLength, dataLength] = header(buf.slice(0, 14));
            const fileList = genList(buf.slice(14, infoListLength + 14));
            
            // 验证文件完整性
            validateFileList(fileList, buf);
            
            // 保存文件
            await saveFile(dir, buf, fileList);
            
            // 处理后续操作
            if (order.includes("o")) {
                wu.addIO(console.log.bind(console), "Unpack done.");
            } else {
                wu.addIO(packDone, dir, cb, order);
            }
        });
    } catch (error) {
        console.error("处理文件失败:", error);
        cb && cb(error);
    }
}

// 新增：验证文件列表完整性
function validateFileList(fileList, buf) {
    for (const file of fileList) {
        if (file.off + file.size > buf.length) {
            throw new Error(`文件 ${file.name} 数据不完整`);
        }
    }
}

// 新增：处理 wxss 文件
function handleWxssFile(data) {
    try {
        const content = data.toString('utf-8');
        // 使用 js-beautify 的 css 格式化
        return beautify.css(content, {
            indent_size: 2,
            indent_char: ' ',
            max_preserve_newlines: 1,
            preserve_newlines: true,
            end_with_newline: true,
            wrap_line_length: 0,
            indent_inner_html: true
        });
    } catch (error) {
        console.error('处理 wxss 文件失败:', error);
        return data.toString('utf-8');
    }
}

// 新增：处理 json 文件
function handleJsonFile(data) {
    try {
        const content = data.toString('utf-8');
        // 解析并格式化 JSON
        const jsonObj = JSON.parse(content);
        return JSON.stringify(jsonObj, null, 2);
    } catch (error) {
        console.error('处理 json 文件失败:', error);
        return data.toString('utf-8');
    }
}

// 新增：处理 wxml 文件
function handleWxmlFile(data) {
    try {
        const content = data.toString('utf-8');
        // 使用 js-beautify 的 html 格式化
        return beautify.html(content, {
            indent_size: 2,
            indent_char: ' ',
            max_preserve_newlines: 1,
            preserve_newlines: true,
            keep_array_indentation: false,
            break_chained_methods: false,
            indent_scripts: 'normal',
            brace_style: 'collapse',
            space_before_conditional: true,
            unescape_strings: false,
            jslint_happy: false,
            end_with_newline: true,
            wrap_line_length: 0,
            indent_inner_html: true,
            comma_first: false,
            e4x: true
        });
    } catch (error) {
        console.error('处理 wxml 文件失败:', error);
        return data.toString('utf-8');
    }
}

// 新增：处理其他类型文件的格式化
function handleDefaultFile(data, fileExtension) {
    // 对于二进制文件，直接返回原始数据
    const binaryExtensions = ['.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp'];
    if (binaryExtensions.includes(fileExtension)) {
        return data;
    }
    
    // 对于文本文件，尝试格式化
    try {
        const content = data.toString('utf-8');
        return content;
    } catch (error) {
        console.error(`文件格式化失败 (${fileExtension}):`, error);
        return data;
    }
}

module.exports = {doFile: doFile};
if (require.main === module) {
    wu.commandExecute(doFile, "Unpack a wxapkg file.\n\n[-o] [-d] [-s=<Main Dir>] <files...>\n\n-d Do not delete transformed unpacked files.\n-o Do not execute any operation after unpack.\n-s=<Main Dir> Regard all packages provided as subPackages and\n              regard <Main Dir> as the directory of sources of the main package.\n<files...> wxapkg files to unpack");
}
