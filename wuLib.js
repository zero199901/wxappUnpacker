const fs = require("fs");
const path = require("path");
const os = require('os');
const beautify = require('js-beautify').html;
let platform = os.platform();

class CntEvent {
    constructor() {
        this.cnt = 0;
        this.emptyEvent = [];
        this.encount = this.encount.bind(this);
        this.decount = this.decount.bind(this);
        this.add = this.add.bind(this);
    }

    encount(delta = 1) {
        this.cnt += delta;
    }

    decount() {
        if (this.cnt > 0) --this.cnt;
        if (this.cnt == 0) {
            for (let info of this.emptyEvent) info[0](...info[1]);
            this.emptyEvent = [];
        }
    }

    add(cb, ...attach) {
        this.emptyEvent.push([cb, attach]);
    }

    check(cb, ...attach) {
        if (this.cnt == 0) cb(...attach);
        else this.add(cb, ...attach);
    }
}

class LimitedRunner {
    constructor(limit) {
        this.limit = limit;
        this.cnt = 0;
        this.funcs = [];
    }

    run(func) {
        if (this.cnt < this.limit) {
            this.cnt++;
            setTimeout(func, 0);
        } else {
            this.funcs.push(func);
        }
    }

    done() {
        if (this.cnt > 0) this.cnt--;
        if (this.funcs.length > 0) {
            this.cnt++;
            setTimeout(this.funcs.shift(), 0);
        }
    }

    runWithCb(func, ...args) {
        let cb = args.pop(), self = this;

        function agent(...args) {
            self.done();
            return cb.apply(this, args);
        }

        args.push(agent);
        this.run(() => func(...args));
    }
}

let ioEvent = new CntEvent;
let ioLimit = new LimitedRunner(4096);

function mkdirs(dir, cb) {
    ioLimit.runWithCb(fs.stat.bind(fs), dir, (err, stats) => {
        if (err) {
            mkdirs(path.dirname(dir), () => {
                fs.mkdir(dir, (err) => {
                    if (err && err.code !== 'EEXIST') {
                        console.error(`创建目录失败: ${dir}`, err);
                        cb(err);
                    } else {
                        cb(null);
                    }
                });
            });
        } else if (stats.isFile()) {
            const error = new Error(`${dir} 是一个文件，无法在其中创建文件`);
            console.error(error.message);
            cb(error);
        } else {
            cb(null);
        }
    });
}

function save(name, content) {
    return new Promise((resolve, reject) => {
        mkdirs(path.dirname(name), function (err) {
            if (err) return reject(err);
            
            // 对HTML文件进行格式化
            if (name.endsWith('.html') || name.endsWith('.wxml')) {
                try {
                    // 确保content是字符串
                    let htmlContent = content;
                    if (Buffer.isBuffer(content)) {
                        htmlContent = content.toString('utf8');
                    }
                    
                    // 检查内容是否为有效的字符串
                    if (typeof htmlContent === 'string' && htmlContent.trim()) {
                        content = beautify(htmlContent, {
                            indent_size: 2,
                            wrap_line_length: 80,
                            preserve_newlines: true,
                            max_preserve_newlines: 2,
                            unformatted: ['code', 'pre', 'em', 'strong', 'span'],
                            extra_liners: ['head', 'body', '/html']
                        });
                    } else {
                        console.warn(`跳过格式化: ${name} (内容为空或无效)`);
                    }
                } catch (e) {
                    console.error(`格式化HTML文件失败: ${name}`, e);
                    // 发生错误时使用原始内容
                    if (Buffer.isBuffer(content)) {
                        content = content.toString('utf8');
                    }
                }
            }
            
            // 确保写入的内容是Buffer或字符串
            if (typeof content !== 'string' && !Buffer.isBuffer(content)) {
                content = String(content);
            }
            
            fs.writeFile(name, content, function (err) {
                if (err) return reject(err);
                resolve();
            });
        });
    });
}

function get(name, cb) {
    if (!cb || typeof cb !== 'function') {
        cb = (data) => { }; // 提供默认的回调函数
    }
    fs.readFile(name, function (err, data) {
        if (err) {
            console.error(`读取文件 ${name} 失败:`, err);
            cb(null);
        }
        else cb(data);
    });
}

function del(name) {
    ioEvent.encount();
    ioLimit.runWithCb(fs.unlink.bind(fs), name, ioEvent.decount);
}

function changeExt(name, ext = "") {
    return name.slice(0, name.lastIndexOf(".")) + ext;
}

function scanDirByExt(dir, ext, cb) {
    let result = [], scanEvent = new CntEvent;

    function helper(dir) {
        scanEvent.encount();
        ioLimit.runWithCb(fs.readdir.bind(fs), dir, (err, files) => {
            if (err) throw Error("Scan dir error: " + err);
            for (let file of files) {
                scanEvent.encount();
                let name = path.resolve(dir, file);
                fs.stat(name, (err, stats) => {
                    if (err) throw Error("Scan dir error: " + err);
                    if (stats.isDirectory()) helper(name);
                    else if (stats.isFile() && name.endsWith(ext)) result.push(name);
                    scanEvent.decount();
                });
            }
            scanEvent.decount();
        });
    }

    scanEvent.add(cb, result);
    helper(dir, ext, scanEvent);
}

function toDir(to, from) {//get relative path without posix/win32 problem
    if (from[0] == ".") from = from.slice(1);
    if (to[0] == ".") to = to.slice(1);
    from = from.replace(/\\/g, '/');
    to = to.replace(/\\/g, '/');
    let a = Math.min(to.length, from.length);
    for (let i = 1, m = Math.min(to.length, from.length); i <= m; i++) if (!to.startsWith(from.slice(0, i))) {
        a = i - 1;
        break;
    }
    let pub = from.slice(0, a);
    let len = pub.lastIndexOf("/") + 1;
    let k = from.slice(len);
    let ret = "";
    for (let i = 0; i < k.length; i++) if (k[i] == '/') ret += '../';
    return ret + to.slice(len);
}

function commonDir(pathA, pathB) {
    if (pathA[0] == ".") pathA = pathA.slice(1);
    if (pathB[0] == ".") pathB = pathB.slice(1);
    pathA = pathA.replace(/\\/g, '/');
    pathB = pathB.replace(/\\/g, '/');
    let a = Math.min(pathA.length, pathB.length);
    for (let i = 1, m = Math.min(pathA.length, pathB.length); i <= m; i++) if (!pathA.startsWith(pathB.slice(0, i))) {
        a = i - 1;
        break;
    }
    let pub = pathB.slice(0, a);
    let len = pub.lastIndexOf("/") + 1;
    return pathA.slice(0, len);
}

function commandExecute(cb, helper) {
    console.time("Total use");

    function endTime() {
        ioEvent.check(() => console.timeEnd("Total use"));
    }

    let orders = [];
    for (let order of process.argv) if (order.startsWith("-")) orders.push(order.slice(1));
    let iter = process.argv[Symbol.iterator](), nxt = iter.next(), called = false, faster = orders.includes("f"),
        fastCnt;
    if (faster) {
        fastCnt = new CntEvent;
        fastCnt.add(endTime);
    }

    function doNext() {
        let nxt = iter.next();
        while (!nxt.done && nxt.value.startsWith("-")) nxt = iter.next();
        if (nxt.done) {
            if (!called) console.log("Command Line Helper:\n\n" + helper);
            else if (!faster) endTime();
        } else {
            called = true;
            if (faster) fastCnt.encount(), cb(nxt.value, fastCnt.decount, orders), doNext();
            else cb(nxt.value, doNext, orders);
        }
    }

    while (!nxt.done && !nxt.value.endsWith(".js")) nxt = iter.next();
    doNext();
}

module.exports = {
    mkdirs: mkdirs, get: get, save: save, toDir: toDir, del: del, addIO: ioEvent.add,
    changeExt: changeExt, CntEvent: CntEvent, scanDirByExt: scanDirByExt, commonDir: commonDir,
    commandExecute: commandExecute
};
