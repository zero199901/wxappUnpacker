# 安装
```
npm install
```

# 安装依赖
```
npm install esprima
    
npm install css-tree
    
npm install cssbeautify
    
npm install vm2
    
npm install uglify-es
    
npm install js-beautify

npm install jsdom
```
# 使用

Android 手机最近使用过的微信小程序所对应的 wxapkg 包文件都存储在特定文件夹下，可通过以下命令查看：

adb pull /data/data/com.tencent.mm/MicroMsg/{User}/appbrand/pkg


--
node wuWxapkg.js  .wxapkg

其中`{User}` 为当前用户的用户名，类似于 `2bc**************b65`。





# 分包功能

当检测到 wxapkg 为子包时, 添加-s 参数指定主包源码路径即可自动将子包的 wxss,wxml,js 解析到主包的对应位置下. 完整流程大致如下: 
1. 获取主包和若干子包
2. 解包主包  
    - windows系统使用: `./bingo.bat testpkg/master-xxx.wxapkg`
    - Linux系统使用: `./bingo.sh testpkg/master-xxx.wxapkg`
3. 解包子包  
    - windows系统使用: `./bingo.bat testpkg/sub-1-xxx.wxapkg -s=../master-xxx`
    - Linux系统使用:  `./bingo.sh testpkg/sub-1-xxx.wxapkg -s=../master-xxx`


TIP
> -s 参数可为相对路径或绝对路径, 推荐使用绝对路径, 因为相对路径的起点不是当前目录 而是子包解包后的目录

```
├── testpkg
│   ├── sub-1-xxx.wxapkg #被解析子包
│   └── sub-1-xxx               #相对路径的起点
│       ├── app-service.js
│   ├── master-xxx.wxapkg
│   └── master-xxx             # ../master-xxx 就是这个目录
│       ├── app.json
```

## 输出文件说明

反编译后会生成以下文件：

- `app-config.json`: 小程序配置文件
- `app-service.js`: 小程序逻辑文件
- `page-frame.js`: 页面框架文件
- `pages/`: 页面文件目录
  - 包含 WXML、WXSS、JS 等源文件
- `components/`: 组件目录
- `wxappUnpacker.log`: 反编译过程日志文件

## 日志说明

日志文件 `wxappUnpacker.log` 包含以下信息：
- 文件处理过程
- 错误信息
- 格式化状态
- 时间戳

## 注意事项

1. 确保系统已安装 Node.js (建议 v12 或更高版本)
2. 部分加密的小程序包可能无法完全反编译
3. 反编译后的代码可能需要手动调整才能正常运行
4. 仅供学习研究使用，请勿用于非法用途

## 常见问题

1. 如果出现 "Magic number 不正确" 错误，说明文件不是有效的 wxapkg 文件
2. 如果出现权限错误，请确保有足够的文件读写权限
3. 分包反编译时必须指定正确的主包目录

## 更新日志

### v1.0.0
- 支持基础反编译功能
- 添加代码格式化
- 添加方法名还原
- 添加日志功能

## 贡献代码

欢迎提交 Issue 和 Pull Request 来帮助改进这个工具。

## 许可证

MIT License
