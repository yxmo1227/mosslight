# 第三方软件与素材声明

本文件对应 Mosslight 0.10.0 的源码阶段依赖与素材记录，不是所有平台或最终归档的许可证放行结论。精确依赖以 `package-lock.json` 为准，最终二进制内的实际内容和许可原文须另行逐项核验，结果见随包验证记录。Three.js 及其类型依赖在 v0.3 引入；v0.5 生产场景改用 Canvas 2D，历史三维源码、测试和开发依赖仍保留，实际运行 bundle 的依赖与分发内容须重新绑定验证。

## 原创内容和视觉参考

原创应用代码、文档、v0.10.0 程序绘制的二维容器 / 基质 / 苔藓 / 植物 / 装饰、四款不同形态与木色的树枝 / 四类石头 / 两类木桩原木 / 十二款植物 / 十八款小景物（另保留旧版小路绘制）、蘑菇和水潭绘图、二维工具图形，以及保留的历史三维实现使用 [MIT](LICENSE)：Copyright (c) 2026 Mosslight contributors。

没有下载或打包参考商家的照片、视频、模型、HDR 环境图、纹理、字体、标志或专有代码。此次柔和插画方向只借鉴氛围和构图，不复制参考图片中的角色、摄影作品或其他识别性资产。界面使用本机已有系统字体，不随包分发字体文件。[设计参考](docs/DESIGN_REFERENCES.md) 记录较早的公开视觉出处，不是资产授权、品牌合作或复制许可。

Mosslight 的 MIT 不会把第三方代码、Electron 内含组件或工具的许可证改为 MIT，也不授予第三方商标权。

## 保留的 Three.js 历史源码依赖与许可

v0.3 引入、v0.4 用于生产场景的 **Three.js 0.186.0** 仍为保留的历史三维源码与测试提供开发依赖；v0.5 起的生产场景不再需要该库或 WebGL。其许可为 MIT，精确安装包 `node_modules/three/LICENSE` 的版权行为：

> Copyright © 2010-2026 three.js authors

Three.js 与 `@types/three` 仍列在 `devDependencies`，不得因此推断其是否进入最终 bundle。v0.10.0 须核验生产入口没有引入历史 Three.js 场景。打包配置继续把安装包原始 LICENSE 复制到应用资源目录 `licenses/Three-LICENSE.txt`，保留实现来源和历史许可。最终 ZIP / DMG 中的原文完整性和可访问性须按实际包检查；链接或本声明不能代替原始许可文本。若未来重新打包其代码，MIT 原文义务仍适用。

当前二维绘图和历史三维实现均使用原创程序图形，不需要下载 Three.js 示例模型、纹理或第三方美术素材；这些示例资产不属于本产品素材来源。

## 直接依赖

| 软件 | 固定版本 | 安装包许可 | 用途 |
| --- | --- | --- | --- |
| three | 0.186.0 | MIT | 保留的历史三维源码 / 测试依赖，不属于 v0.10.0 生产绘图路径；精确原文为 `node_modules/three/LICENSE` |
| @types/three | 0.186.0 | MIT | 历史 Three.js 实现的类型声明，Microsoft Corporation |
| Electron | 44.4.1 | MIT；内含组件另有许可 | 随应用分发的桌面运行时 |
| electron-builder | 26.15.3 | MIT | 打包工具 |
| esbuild | 0.28.2 | MIT | 构建工具 |
| tsx | 4.20.5 | MIT | TypeScript 测试工具 |
| TypeScript | 5.9.3 | Apache-2.0 | 类型检查 |
| Playwright | 1.55.1 | Apache-2.0 | 桌面验证工具；安装包附 NOTICE |
| @types/node | 24.3.0 | MIT | Node 类型声明 |

上表依据本地精确安装包元数据和随包许可证。它不是仅根据上游主分支许可推断安装版本；也不能替代最终内容检查。

### 新增类型包带入的传递依赖

相对 v0.2 锁文件，新增 Three.js、其类型包以及以下六个包；已有依赖版本没有因这一批新增而改变。下面的类型包依赖不等于本应用启用了物理、压缩或网格优化功能。

| 包 | 锁定版本 | 本地原始许可 / 版权 |
| --- | --- | --- |
| @dimforge/rapier3d-compat | 0.12.0 | Apache-2.0；Copyright 2020 Dimforge EURL |
| @tweenjs/tween.js | 23.1.3 | MIT；Tween.js authors 及 Robert Penner easing 版权声明 |
| @types/stats.js | 0.17.4 | MIT；Microsoft Corporation |
| @types/webxr | 0.5.24 | MIT；Microsoft Corporation |
| fflate | 0.8.3 | MIT；Copyright (c) 2026 Arjun Barrett |
| meshoptimizer | 1.1.1 | MIT；Copyright (c) 2016-2026 Arseny Kapoulkine |

这些包由 `@types/three` 依赖树带入，安装包都有 LICENSE 原文；最终生产 bundle 输入仍须核验，不能仅凭“类型依赖”推断未打包。若实际再分发它们的代码或资源，必须同时保留适用原文和 notices。源码包只提供引用与锁文件，不附 `node_modules/`。

## Electron 运行时

Electron 包含 Chromium、Node.js、V8 及许多其他组件，**不能概括为“所有组件都是 MIT”**。保留上游原始版权、许可和第三方声明，包括 `LICENSE`、`LICENSES.chromium.html` 及平台分发中其他必要文件。

应用自己的 LICENSE 不得覆盖 Electron 原文。当前配置另外复制 `licenses/Electron-LICENSE.txt` 和 `licenses/LICENSES.chromium.html`；最终归档必须逐字核验，与 Three.js 原文分别保存。构建工具有自己的许可证，安装器引入的 stub / 插件也有独立义务。

## 分发前仍须完成

- 核验实际 bundle 输入、app.asar / ZIP 内容及所有再分发组件，而不只查看 npm 的 dev / prod 分类。
- 保留原创 MIT、Three.js MIT、Electron 及内含组件许可原文；必要时保留 Apache-2.0 NOTICE、版权和修改说明。未知或缺失项须先解决。
- 审查构建工具额外下载内容，确保当前完整 ZIP 没有意外 NSIS / elevate 插件；NSIS 嵌入插件许可尚未清理完成，Setup 不在可分发范围。
- 对各平台实际产物分别解包，检查许可没有覆盖、丢失或被错误重命名；没有私有数据、凭据、外部商家素材或未授权字体。
- 记录版本、最终摘要、审阅范围和未决项。安全公告扫描不等于许可证审核，也不能证明所有软件安全。

参见 [v0.10.0 发布门禁](docs/RELEASING_0.10.md) 及其[验证记录说明](docs/RELEASING_0.10.md#verification-record)。本文件不授权创建远程仓库、上传或公开 Release。
