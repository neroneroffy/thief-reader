# 欢迎使用您的 VS Code 扩展

## 文件夹内容

* 此文件夹包含您的扩展所需的所有文件。
* `package.json` - 这是清单文件，您在其中声明扩展和命令。
  * 示例插件注册一个命令并定义其标题和命令名称。有了这些信息，VS Code 就可以在命令面板中显示该命令。它还不需要加载插件。
* `extension.js` - 这是主文件，您将在其中提供命令的实现。
  * 该文件导出一个函数 `activate`，它在您的扩展第一次被激活时调用（在这种情况下是通过执行命令）。在 `activate` 函数内部，我们调用 `registerCommand`。
  * 我们将包含命令实现的函数作为第二个参数传递给 `registerCommand`。

## 立即启动和运行

* 按 `F5` 打开一个加载了您的扩展的新窗口。
* 通过按 (`Ctrl+Shift+P` 或 Mac 上的 `Cmd+Shift+P`) 并输入 `Hello World` 从命令面板运行您的命令。
* 在 `extension.js` 中的代码中设置断点来调试您的扩展。
* 在调试控制台中查找来自您的扩展的输出。

## 进行更改

* 在更改 `extension.js` 中的代码后，您可以从调试工具栏重新启动扩展。
* 您也可以重新加载 (`Ctrl+R` 或 Mac 上的 `Cmd+R`) 带有您的扩展的 VS Code 窗口来加载您的更改。

## 探索 API

* 当您打开文件 `node_modules/@types/vscode/index.d.ts` 时，您可以查看我们完整的 API 集合。

## 运行测试

* 安装 [Extension Test Runner](https://marketplace.visualstudio.com/items?itemName=ms-vscode.extension-test-runner)
* 从活动栏打开测试视图并点击"运行测试"按钮，或使用快捷键 `Ctrl/Cmd + ; A`
* 在测试结果视图中查看测试结果的输出。
* 对 `test/extension.test.js` 进行更改或在 `test` 文件夹内创建新的测试文件。
  * 提供的测试运行器只会考虑匹配名称模式 `**.test.js` 的文件。
  * 您可以在 `test` 文件夹内创建文件夹，以任何您想要的方式组织您的测试。

## 进一步发展

* [遵循 UX 指南](https://code.visualstudio.com/api/ux-guidelines/overview) 创建与 VS Code 原生界面和模式无缝集成的扩展。
* 在 VS Code 扩展市场上 [发布您的扩展](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)。
* 通过设置 [持续集成](https://code.visualstudio.com/api/working-with-extensions/continuous-integration) 自动化构建。
* 集成到 [问题报告](https://code.visualstudio.com/api/get-started/wrapping-up#issue-reporting) 流程中，以获取用户报告的问题和功能请求。