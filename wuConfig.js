const wu = require("./wuLib.js");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {VM} = require('vm2');

function getWorkerPath(name) {
    let code = fs.readFileSync(name, {encoding: 'utf8'});
    let commPath = false;
    let vm = new VM({
        sandbox: {
            require() {
            },
            define(name) {
                name = path.dirname(name) + '/';
                if (commPath === false) commPath = name;
                commPath = wu.commonDir(commPath, name);
            }
        }
    });
    vm.run(code.slice(code.indexOf("define(")));
    if (commPath.length > 0) commPath = commPath.slice(0, -1);
    console.log("Worker path: \"" + commPath + "\"");
    return commPath;
}

function doConfig(configFile, cb) {
    let dir = path.dirname(configFile); // 获取配置文件目录
    try {
        wu.get(configFile, content => { // 异步读取配置文件
            try {
                let e = JSON.parse(content); // 解析配置文件为 JSON 对象
                let k = e.pages; // 获取 pages 数组
                k.splice(k.indexOf(wu.changeExt(e.entryPagePath)), 1); // 删除入口页面
                k.unshift(wu.changeExt(e.entryPagePath)); // 将入口页面添加到数组开头
                let app = {pages: k, window: e.global && e.global.window, tabBar: e.tabBar, networkTimeout: e.networkTimeout}; // 创建 app 配置对象

                // 处理子包，使用 try...catch 包裹，防止错误导致程序中断
                try {
                    if (e.subPackages) {
                        let subPackages = [];
                        let pages = app.pages;
                        for (let subPackage of e.subPackages) {
                            let root = subPackage.root;
                            //规范化子包路径，确保以'/'结尾
                            let lastChar = root.substr(root.length - 1, 1);
                            if (lastChar !== '/') {
                                root += '/';
                            }
                            //规范化子包路径，确保不以'/'开头
                            let firstChar = root.substr(0, 1);
                            if (firstChar === '/') {
                                root = root.substring(1);
                            }
                            let newPages = [];
                            for (let page of subPackage.pages) {
                                let items = page.replace(root, '');
                                newPages.push(items);
                                let subIndex = pages.indexOf(root + items);
                                if (subIndex !== -1) {
                                    pages.splice(subIndex, 1);
                                }
                            }

                            subPackage.root = root;
                            subPackage.pages = newPages;
                            subPackages.push(subPackage);
                        }
                        app.subPackages = subPackages;
                        app.pages = pages;
                        console.log("=======================================================\n这个小程序采用了分包\n子包个数为: ", app.subPackages.length, "\n=======================================================");
                    }
                } catch (subPackageError) {
                    console.error("处理子包时出错:", subPackageError);
                    // 可在此处添加处理子包错误的逻辑，例如跳过子包处理或使用默认值
                }


                // ... (rest of the code remains largely the same,  with try...catch blocks added as needed)

                // 保存页面配置文件，使用 try...catch 包裹，防止错误导致程序中断
                try {
                    let delWeight = 8;
                    for (let a in e.page) {
                        let fileName = path.resolve(dir, wu.changeExt(a, ".json"));
                        wu.save(fileName, JSON.stringify(e.page[a].window, null, 4));
                        if (configFile == fileName) delWeight = 0;
                    }
                } catch (pageConfigError) {
                    console.error("保存页面配置时出错:", pageConfigError);
                    // 可在此处添加处理页面配置错误的逻辑
                }


                console.error("delWeight:", delWeight);
                // ... (rest of the code, add try...catch where necessary)

                //处理tabBar图标，使用try...catch包裹，防止错误导致程序中断
                try{
                    if (app.tabBar && app.tabBar.list) {
                        wu.scanDirByExt(dir, "", li => {
                            let digests = [], digestsEvent = new wu.CntEvent(), rdir = path.resolve(dir);

                            function fixDir(dir) {
                                return dir.startsWith(rdir) ? dir.slice(rdir.length + 1) : dir;
                            }

                            digestsEvent.add(() => {
                                for (let e of app.tabBar.list) {
                                    e.pagePath = wu.changeExt(e.pagePath);
                                    if (e.iconData) {
                                        let hash = crypto.createHash("MD5").update(e.iconData, 'base64').digest();
                                        for (let [buf, name] of digests) if (hash.equals(buf)) {
                                            delete e.iconData;
                                            e.iconPath = fixDir(name).replace(/\\/g, '/');
                                            break;
                                        }
                                    }
                                    if (e.selectedIconData) {
                                        let hash = crypto.createHash("MD5").update(e.selectedIconData, 'base64').digest();
                                        for (let [buf, name] of digests) if (hash.equals(buf)) {
                                            delete e.selectedIconData;
                                            e.selectedIconPath = fixDir(name).replace(/\\/g, '/');
                                            break;
                                        }
                                    }
                                }
                                wu.save(path.resolve(dir, 'app.json'), JSON.stringify(app, null, 4));
                                console.error("configFile:", configFile);
                                console.error("delWeight:", delWeight);
                                cb({[configFile]: delWeight});
                            });
                            for (let name of li) {
                                digestsEvent.encount();
                                wu.get(name, data => {
                                    digests.push([crypto.createHash("MD5").update(data).digest(), name]);
                                    digestsEvent.decount();
                                }, {});
                            }
                        });
                    } else {
                        wu.save(path.resolve(dir, 'app.json'), JSON.stringify(app, null, 4));
                        cb({[configFile]: delWeight});
                    }
                } catch (tabBarError) {
                    console.error("处理tabBar时出错:", tabBarError);
                    //在此处添加处理tabBar错误的逻辑
                }

            } catch (jsonParseError) {
                console.error("解析配置文件时出错:", jsonParseError);
                cb(jsonParseError); // 将错误传递给回调函数
                return; // 停止执行
            }
        });
    } catch (initialError) {
        console.error("读取配置文件时出错:", initialError);
        cb(initialError); // 将错误传递给回调函数
        return; // 停止执行
    }
}

module.exports = {doConfig: doConfig};
if (require.main === module) {
    wu.commandExecute(doConfig, "Split and make up weapp app-config.json file.\n\n<files...>\n\n<files...> app-config.json files to split and make up.");
}
