/**
 * 整理曲库的索引页。
 *
 * 角色变了：导航改版后这几个工具都是一级目的地，桌面侧栏直接能点到，
 * 所以这一页不再是"唯一入口"，而是两件事：
 *   1. 手机底栏"更多"的落地页（底栏只有五格，放不下工具）；
 *   2. 一眼看出有没有事等着处理。
 *
 * 所以顺序是"要处理的事"在前、"工具列表"在后 ——
 * 打开这一页的人多半是想知道"待处理"。
 *
 * 重构前这里把工具按"文件与下载 / PLEX 资料 / 连接与运行"分三组，
 * 每组配一句技术化的小标题（"服务、队列与故障"）。
 * 五个条目分三组没有意义，直接平铺。
 */

import { CircleAlert, Music2, Settings } from "lucide-react";
import { Button } from "../../components/ui/Button";
import {
  ListGroup,
  ListRow,
  Page,
  Section,
  SectionHeader,
} from "../../components/ui/Layout";
import { StatGrid, StatTile } from "../../components/ui/StatTile";
import { managementNav } from "../../lib/nav-model";

export function ManagementHub({ navigate, stats, jobs, permissions = [] }) {
  const waiting = jobs.filter((job) => job.status === "waiting_confirm").length;
  const failed = jobs.filter((job) => job.status === "failed").length;

  const can = (permission) =>
    permissions.includes(permission) || permissions.includes("manage_users");

  const tools = managementNav.filter((item) =>
    item.id === "sources" ? can("manage_sources") : can("manage_library"),
  );

  const needsAttention = waiting > 0 || failed > 0;

  return (
    <Page>
      {/* --- 有事等着处理时才出现，没事不占地方 --- */}
      {needsAttention && (
        <Section>
          <SectionHeader
            title="待处理"
            moreLabel="去任务"
            onMore={() => navigate("tasks")}
          />
          <StatGrid>
            {waiting > 0 && (
              <StatTile
                icon={CircleAlert}
                tone="warning"
                value={waiting}
                label="首下载完等确认"
                detail="确认后进曲库"
                onClick={() => navigate("download")}
              />
            )}
            {failed > 0 && (
              <StatTile
                icon={CircleAlert}
                tone="danger"
                value={failed}
                label="个任务需要重试"
                detail="点开查看失败原因"
                onClick={() => navigate("tasks")}
              />
            )}
          </StatGrid>
        </Section>
      )}

      {/* --- 曲库现状 --- */}
      <Section>
        <SectionHeader title="曲库现状" />
        <StatGrid>
          <StatTile
            icon={Music2}
            tone="accent"
            value={stats?.tracks ?? 0}
            label="首歌"
          />
          <StatTile
            value={stats?.missingLyrics ?? 0}
            label="首缺歌词"
            detail={stats?.missingLyrics ? "可以在封面与歌词里补" : "都齐了"}
            onClick={() => navigate("scrape")}
          />
          <StatTile
            value={stats?.missingCover ?? 0}
            label="张缺封面"
            detail={stats?.missingCover ? "可以在封面与歌词里补" : "都齐了"}
            onClick={() => navigate("scrape")}
          />
        </StatGrid>
      </Section>

      {/* --- 工具 --- */}
      <Section>
        <SectionHeader title="常用操作" />
        <ListGroup>
          {tools.map((item) => (
            <ListRow
              key={item.id}
              leading={
                <span className="hub-tool-icon">
                  <item.icon />
                </span>
              }
              title={item.label}
              subtitle={item.desc}
              onClick={() => navigate(item.id)}
            />
          ))}
        </ListGroup>
      </Section>

      {/* 手机上从"更多"进来的人也需要能到设置。 */}
      <Button icon={Settings} block onClick={() => navigate("settings")}>
        设置
      </Button>
    </Page>
  );
}
