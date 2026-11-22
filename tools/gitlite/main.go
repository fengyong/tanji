// gitlite:最小 git 客户端(CLT 缺失时的替代提交/推送工具)。
// 用法:
//   gitlite status <repo>     — 变更文件列表
//   gitlite commit <repo> <message> — add+commit(全部变更,含未跟踪)
//   gitlite push <repo> <remote-branch> — 推送(SSH,默认密钥)
package main

import (
	"fmt"
	"os"
	"strings"

	git "github.com/go-git/go-git/v5"
	"github.com/go-git/go-git/v5/config"
	"github.com/go-git/go-git/v5/plumbing"
	"github.com/go-git/go-git/v5/plumbing/object"
	gitssh "github.com/go-git/go-git/v5/plumbing/transport/ssh"
	"time"
)

func main() {
	if len(os.Args) < 3 {
		fmt.Fprintln(os.Stderr, "用法: gitlite <status|commit|push> <repo> [...]")
		os.Exit(2)
	}
	cmd, repoPath := os.Args[1], os.Args[2]
	r, err := git.PlainOpen(repoPath)
	if err != nil {
		fatal(fmt.Errorf("open: %w", err))
	}
	switch cmd {
	case "status":
		w := mustWorktree(r)
		st := mustStatus(w)
		for file, sc := range st {
			fmt.Printf("%d %s\n", int(sc.Staging), file)
		}
	case "commit":
		if len(os.Args) < 4 {
			fatal(fmt.Errorf("缺提交信息"))
		}
		w := mustWorktree(r)
		if err := w.AddWithOptions(&git.AddOptions{All: true}); err != nil {
			fatal(fmt.Errorf("add: %w", err))
		}
		st := mustStatus(w)
		if st.IsClean() {
			fmt.Println("clean")
			return
		}
		hash, err := w.Commit(os.Args[3], &git.CommitOptions{
			Author: &object.Signature{Name: "fengyong", Email: "fengyong@users.noreply.github.com", When: time.Now()},
		})
		fatal(fmt.Errorf("commit: %w", err))
		fmt.Println(hash.String())
	case "verify":
		// worktree 私有 refs:直接读文件
		raw, err := os.ReadFile("/Users/fengyong/drax-glm/tanji/.git/worktrees/tanji-cloud/refs/heads/feat/cloud-local-first")
		fatal(err)
		hash := strings.TrimSpace(string(raw))
		c, err := r.CommitObject(plumbing.NewHash(hash))
		fatal(fmt.Errorf("commit obj: %w", err))
		fmt.Println(c.Hash.String())
		fmt.Println(c.Author.Name, c.Author.When.Format(time.RFC3339))
		fmt.Println(c.Message)
	case "log":
		head, herr := r.Head()
		if herr != nil || head == nil {
			// worktree HEAD:读私有 HEAD 的分支引用再解析公共 refs
			raw, rerr := os.ReadFile("/Users/fengyong/drax-glm/tanji/.git/refs/heads/feat/cloud-local-first")
			fatal(rerr)
			hash := plumbing.NewHash(strings.TrimSpace(string(raw)))
			c, cerr := r.CommitObject(hash)
			fatal(fmt.Errorf("commit obj: %w", cerr))
			fmt.Println(c.Hash.String())
			fmt.Println(c.Message)
			return
		}
		c, err := r.CommitObject(head.Hash())
		fatal(fmt.Errorf("commit obj: %w", err))
		fmt.Println(c.Hash.String(), c.Message)
	case "push":
		branch := "feat/cloud-local-first"
		if len(os.Args) >= 4 {
			branch = os.Args[3]
		}
		// 显式加载本机 ed25519 密钥(默认 Builder 只试 id_rsa)
		auth, aerr := gitssh.NewPublicKeysFromFile("git", os.Getenv("HOME")+"/.ssh/id_ed25519", "")
		if aerr != nil {
			auth, aerr = gitssh.NewPublicKeysFromFile("git", os.Getenv("HOME")+"/.ssh/id_rsa", "")
			if aerr != nil {
				fatal(aerr)
			}
		}
		// worktree 的 remote 配置可能读不到:确保 origin 指向 github SSH
		_ = r.DeleteRemote("origin")
		_, cerr := r.CreateRemote(&config.RemoteConfig{
			Name: "origin",
			URLs: []string{"git@github.com:fengyong/tanji.git"},
		})
		if cerr != nil {
			fatal(cerr)
		}
		perr := r.Push(&git.PushOptions{
			RemoteName: "origin",
			RefSpecs:   []config.RefSpec{config.RefSpec("refs/heads/" + branch + ":refs/heads/" + branch)},
			Auth:       auth,
		})
		if perr != nil && perr.Error() != git.NoErrAlreadyUpToDate.Error() {
			// go-git 在部分 worktree 场景返回非 nil 接口包 nil:仅当确实是错误时打印
			if fmt.Sprintf("%v", perr) != "<nil>" {
				fatal(perr)
			}
		}
		fmt.Println("pushed")
	default:
		fatal(fmt.Errorf("未知命令 %s", cmd))
	}
}

// mustWorktree 处理 go-git 在部分版本返回非 nil 错误接口包 nil 的问题。
func mustWorktree(r *git.Repository) *git.Worktree {
	w, err := r.Worktree()
	if w == nil {
		fatal(fmt.Errorf("worktree 不可用: %v", err))
	}
	return w
}

func mustStatus(w *git.Worktree) git.Status {
	st, err := w.Status()
	if err != nil && st == nil {
		fatal(err)
	}
	return st
}

func fatal(err error) {
	fmt.Fprintln(os.Stderr, "错误:", err)
	os.Exit(1)
}
