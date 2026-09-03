/**
 * 改动历史。
 *
 * 之前这一页只能告诉你"写入标签 · 3 小时前 · 成功"，
 * 而这一页存在的唯一理由恰恰是回答另一个问题：**那次到底动了什么？**
 * 对 NAS 用户来说最怕的就是文件被挪了不知道挪去哪。
 *
 * 三个决定：
 *
 * 1. 按天分组，一次运行折成一条。一次整理动了 37 个文件，
 *    摊成 37 行既读不下去，也看不出它们本来是一个决定。
 * 2. 默认收起，展开才看每个文件的 原值 → 新值。
 *    列表要能扫，细节要能查，两件事不能挤在一个层级里。
 * 3. 撤销以"一次运行"为单位。逐条撤销一个 37 文件的整理，
 *    是让用户点 37 次，而且中途放弃就留下一半。
 */

import {
  ChevronRight,
  CircleAlert,
  FolderTree,
  RotateCcw,
  Tags,
} from "lucide-react";
import { useState } from "react";
import { Badge } from "../../components/ui/Badge";
import { Button, ButtonGroup } from "../../components/ui/Button";
import { Notice } from "../../components/ui/Field";
import { EmptyState, Section, SectionHeader } from "../../components/ui/Layout";
import { Modal } from "../../components/ui/Modal";
import { PathText } from "../../components/ui/PathText";
import { timeAgo } from "../../lib/format";

const ACTION_ICONS = {
  tag_write: Tags,
  organize_move: FolderTree,
  download_ingest: FolderTree,
  download_inbox_ingest: FolderTree,
};

const FIELD_LABELS = {
  title: "标题",
  artist: "歌手",
  album: "专辑",
  albumArtist: "专辑歌手",
};

/**
 * 按天分组。
 *
 * 用本地日期字符串比较，不是时间戳差值 —— "今天 00:30" 和
 * "昨天 23:50" 只差 40 分钟，但它们属于不同的两天，
 * 用 24 小时窗口分组会把它们并成一组。
 */
function groupByDay(groups) {
  const today = new Date().toLocaleDateString("zh-CN");
  const yesterday = new Date(Date.now() - 86_400_000).toLocaleDateString("zh-CN");
  const days = [];
  for (const group of groups) {
    const date = new Date(group.at);
    const key = Number.isNaN(date.getTime())
      ? "未知时间"
      : date.toLocaleDateString("zh-CN");
    const label =
      key === today ? "今天" : key === yesterday ? "昨天" : key;
    if (days.length && days[days.length - 1].key === key) {
      days[days.length - 1].groups.push(group);
    } else {
      days.push({ key, label, groups: [group] });
    }
  }
  return days;
}

const timeOf = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
};

export function ChangeHistory({ data, onReload, notify, onError }) {
  const [expanded, setExpanded] = useState(() => new Set());
  const [pending, setPending] = useState(null);
  const [busy, setBusy] = useState(false);

  const groups = data?.groups || [];
  const days = groupByDay(groups);

  const toggle = (id) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const rollback = async () => {
    const target = pending;
    setPending(null);
    if (!target) return;
    setBusy(true);
    try {
      const result = await onReload(target.rollbackableIds);
      // 部分失败也要说清楚。只报"已恢复"会让用户以为全好了，
      // 而实际上有几个文件因为原位置被占用没能写回去。
      if (result?.failed?.length) {
        onError?.(
          `恢复了 ${result.restored} 个，${result.failed.length} 个没能恢复：` +
            result.failed
              .slice(0, 3)
              .map((item) => item.error)
              .join("；"),
        );
      } else {
        notify?.(`已恢复 ${result?.restored ?? target.count} 个文件`);
      }
    } catch (err) {
      onError?.(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (!groups.length) {
    return (
      <Section>
        <SectionHeader
          title="改动历史"
          note="可整批撤销"
        />
        <EmptyState
          icon={RotateCcw}
          title="还没有改动记录"
          text="改动过曲库之后，每次都会记在这里"
        />
      </Section>
    );
  }

  return (
    <Section>
      <SectionHeader
        title="改动历史"
        note={`${groups.length} 次运行`}
      />

      <ol className="timeline">
        {days.map((day) => (
          <li key={day.key} className="timeline__day">
            <h3 className="timeline__date">{day.label}</h3>
            <ol className="timeline__runs">
              {day.groups.map((group) => {
                const Icon = ACTION_ICONS[group.action] || RotateCcw;
                const open = expanded.has(group.id);
                const undone = group.rolledBack >= group.count;
                return (
                  <li
                    key={group.id}
                    className={`timeline__run${undone ? " is-undone" : ""}`}
                  >
                    <span className="timeline__dot" aria-hidden="true">
                      <Icon />
                    </span>

                    <div className="timeline__head">
                      <div className="timeline__title">
                        <strong>{group.actionLabel}</strong>
                        <span>{group.count} 个文件</span>
                        <time>{timeOf(group.at)}</time>
                      </div>
                      <div className="timeline__badges">
                        {group.failed > 0 && (
                          <Badge tone="danger">{group.failed} 个失败</Badge>
                        )}
                        {group.rolledBack > 0 && (
                          <Badge tone="neutral">
                            {undone ? "已撤销" : `撤销了 ${group.rolledBack} 个`}
                          </Badge>
                        )}
                      </div>
                      <ButtonGroup>
                        <Button
                          size="sm"
                          variant="quiet"
                          trailing={ChevronRight}
                          aria-expanded={open}
                          className={open ? "timeline__toggle is-open" : "timeline__toggle"}
                          onClick={() => toggle(group.id)}
                        >
                          {open ? "收起" : "查看明细"}
                        </Button>
                        {/* 没有可撤销的条目就不给按钮 ——
                            一个点了必然失败的按钮比没有按钮更糟。 */}
                        {group.rollbackableIds.length > 0 && (
                          <Button
                            size="sm"
                            icon={RotateCcw}
                            disabled={busy}
                            onClick={() => setPending(group)}
                          >
                            撤销
                          </Button>
                        )}
                      </ButtonGroup>
                    </div>

                    {open && (
                      <ul className="timeline__items">
                        {group.items.map((item) => {
                          // 移动类的改动里，"新值"就是这个文件现在的位置，
                          // 再单独把 target 打一遍等于同一条路径出现两次。
                          const isMove = item.changes.every(
                            (change) => change.kind === "move",
                          );
                          return (
                          <li key={item.id}>
                            {(!isMove || !item.changes.length) && (
                              <PathText path={item.target} />
                            )}
                            {item.changes.length ? (
                              <span className="timeline__changes">
                                {item.changes.map((change, index) =>
                                  change.kind === "move" ? (
                                    <span className="timeline__move" key={index}>
                                      <PathText path={change.oldValue} />
                                      <ChevronRight aria-hidden="true" />
                                      <PathText path={change.newValue} />
                                    </span>
                                  ) : (
                                    <span className="timeline__field" key={index}>
                                      <small>
                                        {FIELD_LABELS[change.field] || change.field}
                                      </small>
                                      {/* 空值不划删除线 —— 划掉"（空）"
                                          会让人以为那三个字本身被删了。 */}
                                      {change.oldValue ? (
                                        <s>{change.oldValue}</s>
                                      ) : (
                                        <i>（空）</i>
                                      )}
                                      <b>{change.newValue}</b>
                                    </span>
                                  ),
                                )}
                              </span>
                            ) : (
                              <small className="timeline__nochange">
                                没有记下具体改了什么
                              </small>
                            )}
                            {item.error && (
                              <small className="timeline__error">{item.error}</small>
                            )}
                          </li>
                          );
                        })}
                        {group.more > 0 && (
                          <li className="timeline__more">
                            还有 {group.more} 个，没有全部列出
                          </li>
                        )}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ol>
          </li>
        ))}
      </ol>

      <Modal
        open={Boolean(pending)}
        onClose={() => setPending(null)}
        title="把这一次的改动全部撤销去？"
        description={
          pending
            ? `${pending.actionLabel} · ${timeAgo(pending.at)} · ${pending.rollbackableIds.length} 个文件`
            : ""
        }
        size="sm"
        actions={
          <ButtonGroup align="end">
            <Button onClick={() => setPending(null)}>取消</Button>
            <Button
              variant="danger"
              icon={RotateCcw}
              loading={busy}
              onClick={rollback}
            >
              全部撤销
            </Button>
          </ButtonGroup>
        }
      >
        <p>
          每个文件都会先检查原位置有没有被别的东西占用，确认安全才写回去。
          中间有几个退不回来不会影响其他的，退不回来的会单独列出原因。
        </p>
        <Notice tone="warning" icon={CircleAlert}>
          这之后你又手动改过的同一个文件，那些改动会被这次退回覆盖。
        </Notice>
      </Modal>
    </Section>
  );
}
