# gitlite — CLT 缺失机器上的最小 git 提交/推送工具

macOS 命令行工具(CLT)丢失时 /usr/bin/git 不可用。本工具基于 go-git(纯 Go),无需编译器:

    cd tools/gitlite && go build -o gitlite .
    ./gitlite commit <仓库路径> "<中文提交信息>"   # add 全部变更 + commit
    ./gitlite push <仓库路径> <分支名>             # SSH 推送(用 ~/.ssh 密钥)
    ./gitlite status <仓库路径>

限制:go-git 在 linked worktree 上会把提交对象与引用写入 worktree 私有 gitdir,
需要人工把 objects 与 branch ref 迁回公共 .git(见主任务记录);主仓库上无此问题。
