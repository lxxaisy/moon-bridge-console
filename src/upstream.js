import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function probeMoonBridgeUpstream(repoDir) {
  const assessment = {
    available: false,
    repoDir,
    currentBranch: "",
    localHead: "",
    originMain: "",
    originDev: "",
    ahead: 0,
    behind: 0,
    merged: false,
    status: "unavailable",
    verdict: "stay_v4",
    label: "无法判断",
    notes: []
  };
  try {
    const currentBranch = await runGit(repoDir, ["rev-parse", "--abbrev-ref", "HEAD"]);
    const localHead = await runGit(repoDir, ["rev-parse", "HEAD"]);
    const originMain = await runGit(repoDir, ["rev-parse", "origin/main"]);
    const originDev = await runGit(repoDir, ["rev-parse", "origin/dev"]);
    const counts = await runGit(repoDir, ["rev-list", "--left-right", "--count", "origin/main...origin/dev"]);
    const [behind, ahead] = counts.split(/\s+/).map((item) => Number(item));
    const merged = await isAncestor(repoDir, "origin/dev", "origin/main");
    const mainHasDev = await isAncestor(repoDir, "origin/main", "origin/dev");
    const classification = classifyUpstream({
      merged,
      mainHasDev,
      ahead: Number.isFinite(ahead) ? ahead : 0,
      behind: Number.isFinite(behind) ? behind : 0
    });
    return {
      ...assessment,
      available: true,
      currentBranch,
      localHead,
      originMain,
      originDev,
      ahead: Number.isFinite(ahead) ? ahead : 0,
      behind: Number.isFinite(behind) ? behind : 0,
      merged,
      status: classification.status,
      verdict: classification.verdict,
      label: classification.label,
      notes: classification.notes
    };
  } catch (error) {
    assessment.notes = [error.message || String(error)];
    return assessment;
  }
}

export function classifyUpstream({ merged, mainHasDev, ahead, behind }) {
  if (merged) {
    return {
      status: "v5_merged",
      verdict: "switch_v5_ready",
      label: "v5 已进入 main，可切到新管理面",
      notes: [
        "main 已包含 dev 的 v5 方向，console 可以开始准备 v5 backend。",
        "如果稳定性测试也通过，v5 会比当前 v4 更适合做配置和运维控制面。"
      ]
    };
  }
  if (mainHasDev) {
    return {
      status: "main_contains_dev",
      verdict: "prepare_v5",
      label: "main 已包含 dev 的大部分内容",
      notes: [
        "v5 方向已经接近主线，但仍建议先保持 v4 工作流。",
        "等 API 和配置结构完全稳定后，再把 console 切成 v5 backend。"
      ]
    };
  }
  if (ahead > 0) {
    return {
      status: "dev_ahead",
      verdict: "stay_v4",
      label: "v5 更强，但还不适合直接切换",
      notes: [
        `dev 比 main 超前 ${ahead} 个提交，包含管理 API、热更新和更细的 metrics 方向。`,
        "对控制面和可观测性来说，v5 方向更强；但对你当前的稳定使用，main/v4 仍然更稳妥。",
        "结论是：现在先继续用 v4，等 v5 合并到 main 再作为默认后端。"
      ]
    };
  }
  if (behind > 0) {
    return {
      status: "main_ahead",
      verdict: "stay_v4",
      label: "main 领先 dev",
      notes: [
        "当前分支状态不支持判断 v5 是更优选择。",
        "继续以 main/v4 为准，等 dev 重新收敛后再评估。"
      ]
    };
  }
  return {
    status: "identical",
    verdict: "stay_v4",
    label: "两个分支目前没有实质差异",
    notes: [
      "当前无法通过 git 差异判断 v5 是否更优。",
      "默认继续使用现有 v4 工作流。"
    ]
  };
}

async function runGit(repoDir, args) {
  const { stdout } = await execFileAsync("git", args, {
    cwd: repoDir,
    maxBuffer: 1024 * 1024
  });
  return stdout.trim();
}

async function isAncestor(repoDir, ancestor, descendant) {
  try {
    await runGit(repoDir, ["merge-base", "--is-ancestor", ancestor, descendant]);
    return true;
  } catch {
    return false;
  }
}
