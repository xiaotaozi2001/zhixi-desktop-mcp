# 知犀桌面版 MCP

连接 Windows 上的知犀桌面应用，读取、新建和编辑思维导图。针对本机安装的 **知犀 3.8.0 / Electron 36.2.1** 编写，使用官方 MCP SDK，Node.js 22+，传输方式为 stdio。

这是非官方桌面适配器。编辑与创建使用知犀自身的操作流程，登录、会员和文件权限仍由知犀检查。没有修改知犀安装包。

## 当前验证状态

- 已通过 25 项自动化测试：真实 MCP stdio 握手和工具发现、参数校验、断线报错、结构转换、版本冲突、只读/锁定保护、编辑无效检测、快照和写操作串行执行等。
- 已确认本机安装文件中的创建入口和编辑命令。
- 已完成真实知犀端到端联调：读取、新建、增加子节点、修改文字、修改备注、撤销、重做、Markdown 输出和过期 revision 防护均已通过。
- 新建导图默认使用知犀官方云端，不再默认创建本地临时导图；本地模式只在显式传入 `storage: "local"` 时启用。
- 详细记录见 [VALIDATION.md](VALIDATION.md)。

## 启动

需要 Windows、已安装的知犀桌面版和 Node.js 22 或更高版本。先克隆仓库：

    git clone https://github.com/xiaotaozi2001/zhixi-desktop-mcp.git
    cd zhixi-desktop-mcp

然后安装锁定的依赖：

    npm.cmd ci

MCP 服务已配置时，直接调用读取、新建等工具即可：应用未运行时自动启动，已连通时复用现有实例。无需先调用 zhixi_launch 或手动运行 BAT。

Codex 使用用户级 config.toml 中的 mcp_servers.zhixi-desktop，command 是 Node.exe，args 是本项目 src/server.js 的绝对路径；示例见 codex-registration.toml；通用 MCP JSON 配置见 mcp-config.json。请将两份示例中的 C:\path\to\zhixi-desktop-mcp 替换为你的实际克隆路径，并根据安装位置调整 Node.js 与知犀可执行文件路径。更新后需重新连接 MCP 服务以载入新代码。

如果经常先手动打开知犀，可一次性安装当前用户快捷方式：在 PowerShell 7 中运行 ./configure-shortcuts.ps1 -InstallForUser -Apply。默认不带 -Apply 只预览。桌面和开始菜单会新增“知犀思维导图（自动连接）”，后续正常点击即可。安装程序需要对应目录写权限；此脚本不会修改知犀安装包、结束进程或更改开机启动。

当前普通实例没有调试端口时，无法无损地在运行中补开。工具保留现有进程并返回 EXISTING_INSTANCE_NO_DEBUG；在下次正常退出后，通过自动连接入口或由 MCP 启动即可。通过旧快捷方式、文件关联或未配置的开机启动先打开知犀，仍可能遇到这个限制。

通过 zhixi_connection_status 可只读查询状态。PROFILE_ACCESS_DENIED 表示运行环境不允许知犀写入自己的用户数据目录，不能用“请保存退出”解决。Codex 沙箱启动失败与已注册的桌面 MCP 运行环境应分别检查。

## 工具

| 工具 | 功能 |
| --- | --- |
| zhixi_connection_status | 检查连接、进程和端口状态，不启动应用 |
| zhixi_launch | 启动或连接知犀，检查页面是否就绪 |
| zhixi_list_maps | 列出已打开的导图、targetId、编辑状态 |
| zhixi_list_folders | 列出云端文件夹，支持指定父目录和递归查询 |
| zhixi_create_folder | 在我的云文档根目录或指定父目录下创建云端文件夹 |
| zhixi_read_map | 读取节点列表、完整 JSON 或 Markdown |
| zhixi_create_map | 通过知犀官方云端创建并打开导图，默认云端 |
| zhixi_open_map | 打开本地 .zxm 绝对路径或云端 fileId |
| zhixi_set_node_text | 修改指定节点文字 |
| zhixi_add_child | 新增子主题 |
| zhixi_set_note | 修改或清空节点备注 |
| zhixi_save_map | 请求知犀执行原生保存 |
| zhixi_undo / zhixi_redo | 撤销 / 重做最近一步 |

多张导图打开时，读取和编辑必须指定 targetId。建议每次编辑都传入上次读取返回的 expectedRevision，避免覆盖已经变化的导图。

示例：向 zhixi_create_map 传入如下参数创建项目计划。节点 key 独立于显示文字，允许多个节点文字相同；parentKey 为 root 表示中心主题。

    {
      "title": "项目计划",
      "storage": "cloud",
      "layout": "default",
      "nodes": [
        { "key": "research", "parentKey": "root", "text": "需求分析" },
        { "key": "interview", "parentKey": "research", "text": "用户访谈" },
        { "key": "build", "parentKey": "root", "text": "开发" },
        { "key": "test", "parentKey": "root", "text": "测试与发布" }
      ]
    }

可对支持该 MCP 的助手说：

> 读取知犀当前打开的导图，列出节点。
>
> 在“需求分析”下新增“竞品调研”，修改前检查 revision。
>
> 在知犀云端创建一个导图，主题是“本周工作计划”。
>
> 修改完成后请求知犀保存。

## 云端文件夹

对应知犀左侧“我的云文档”中的文件夹树。无需打开导图，使用当前登录账号。

- 创建根目录文件夹：调用 `zhixi_create_folder`，参数 `{"title":"学习资料"}`。
- 列出现有目录：调用 `zhixi_list_folders`，参数 `{}`；返回每个目录的数字 `id` 和字符串 `fileId`。
- 创建子文件夹：调用 `zhixi_create_folder`，参数 `{"title":"第一章","parentId":123}`，将 123 替换为父目录的数字 `id`。
- 查看完整目录树：调用 `zhixi_list_folders`，参数 `{"recursive":true}`。

`parentId` 默认 0（我的云文档根目录），不能使用 `fileId` 替代。新工具需要 MCP 客户端重新连接服务后才能发现。加密目录暂不支持提供密码，权限错误由知犀返回。创建结果不明确时先查询目录，不要直接重试。

## 保存及限制

- .zxm 是知犀封装格式，不能按普通 JSON 文件读写。本服务不会直接覆写 .zxm。
- 新建导图默认直接创建到当前知犀账户的云端；不会默认创建本地临时文档。
- `saveRequested: true` 仅代表已发出保存命令；云端同步由知犀官方客户端完成，应在知犀界面确认同步状态。
- 本地模式仅用于显式 `storage: local` 的场景；首次保存本地导图仍需用户在知犀对话框中选择位置。
- 修改文字会将该节点的富文本转换为纯文本；不保留节点文字内部的混合样式。
- 只读、已锁定、正在输入、有弹窗或未渲染的节点会拒绝修改。先在知犀中处理这些状态。
- 每次修改前在 .state/snapshots/ 保存 JSON 快照。它不含图片附件等二进制数据，也不等同于完整 .zxm 备份；当前未提供自动恢复工具。
- 撤销/重做使用知犀自己的历史，可能涉及用户刚刚手动执行的操作。
- 目前不提供删除文档、任意脚本执行、修改账号设置等工具。
- 当前适配器依赖 3.8.0 的内部模块；知犀升级后可能需要调整 src/bridge.js。不保证其他版本兼容。
- 调试端口只使用本机回环地址，不要转发或暴露到局域网/公网。

## 环境变量

| 变量 | 默认值 |
| --- | --- |
| ZHIXI_EXE | C:\Program Files\ZhiXi\ZXMind\zhiximind-desktop.exe |
| ZHIXI_DEBUG_PORT | 19222 |
| ZHIXI_AUTO_LAUNCH | 1；设为 0 禁止工具自动启动 |
| ZHIXI_MCP_STATE_DIR | 项目目录下 .state |

环境变量中的端口应与启动脚本相同。依赖已锁定在 package-lock.json 中。

## 开发

    npm.cmd test
    npm.cmd run doctor

代码划分：cdp.js 管理本机连接，bridge.js 是固定的应用适配器，adapter.js 负责文档选择和快照，model.js 负责节点结构转换，server.js 定义 MCP 工具。
