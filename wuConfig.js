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

async function doConfig(configFile, cb) {
    let content = fs.readFileSync(configFile, 'utf8');
    try {
        let config = JSON.parse(content);
        // 确保config不为undefined
        if (!config) {
            console.error("配置文件为空或格式不正确");
            return cb && cb({}); // 返回空对象而不是undefined
        }
        const dir = path.dirname(configFile);
        
        // 构建基础配置
        const app = buildBaseConfig(config);
        
        // 处理子包
        try {
            processSubPackages(config, app);
        } catch (error) {
            console.error("子包处理错误:", error);
        }
        
        // 处理页面配置
        try {
            await processPageConfigs(config, dir, configFile);
        } catch (error) {
            console.error("页面配置处理错误:", error);
        }
        
        // 处理 tabBar
        try {
            await processTabBar(app, dir, cb, configFile);
        } catch (error) {
            console.error("TabBar 处理错误:", error);
        }
        
        return cb && cb(config);
    } catch (e) {
        console.error("配置文件解析错误:", e.message);
        return cb && cb({}); // 出错时返回空对象
    }
}

function buildBaseConfig(config) {
    let k = config.pages;
    k.splice(k.indexOf(wu.changeExt(config.entryPagePath)), 1);
    k.unshift(wu.changeExt(config.entryPagePath));
    let app = {pages: k, window: config.global && config.global.window, tabBar: config.tabBar, networkTimeout: config.networkTimeout};
    return app;
}

function processSubPackages(config, app) {
    if (!config.subPackages) return;
    
    let subPackages = [];
    let pages = app.pages;
    for (let subPackage of config.subPackages) {
        let root = normalizeSubPackagePath(subPackage.root);
        let newPages = processSubPackagePages(subPackage, root, pages);
        
        subPackage.root = root;
        subPackage.pages = newPages;
        subPackages.push(subPackage);
    }
    
    app.subPackages = subPackages;
    app.pages = pages;
    console.log("=======================================================\n这个小程序采用了分包\n子包个数为: ", app.subPackages.length, "\n=======================================================");
}

function normalizeSubPackagePath(root) {
    if (!root.endsWith('/')) root += '/';
    if (root.startsWith('/')) root = root.substring(1);
    return root;
}

function processSubPackagePages(subPackage, root, pages) {
    let newPages = [];
    for (let page of subPackage.pages) {
        let items = page.replace(root, '');
        newPages.push(items);
        let subIndex = pages.indexOf(root + items);
        if (subIndex !== -1) {
            pages.splice(subIndex, 1);
        }
    }
    return newPages;
}

async function processPageConfigs(config, dir, configFile) {
    let delWeight = 8;
    for (let a in config.page) {
        let fileName = path.resolve(dir, wu.changeExt(a, ".json"));
        wu.save(fileName, JSON.stringify(config.page[a].window, null, 4));
        if (configFile == fileName) delWeight = 0;
    }
    console.error("delWeight:", delWeight);
}

async function processTabBar(app, dir, cb, configFile) {
    let delWeight = 8;
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
}

module.exports = {doConfig: doConfig};
if (require.main === module) {
    wu.commandExecute(doConfig, "Split and make up weapp app-config.json file.\n\n<files...>\n\n<files...> app-config.json files to split and make up.");
}
