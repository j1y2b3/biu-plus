import { create } from "zustand";
import { persist } from "zustand/middleware";

/** 用于定位单曲的最小字段（PlayData 是它的超集） */
export interface SongTrimTarget {
  type?: "mv" | "audio";
  bvid?: string;
  cid?: string;
  sid?: number;
  source?: "local" | "online";
  id?: string;
}

/** 单曲裁剪配置：跳过开头/结尾的秒数 */
export interface SongTrim {
  /** 跳过开头的秒数 */
  start: number;
  /** 跳过结尾的秒数 */
  end: number;
}

/**
 * 生成单曲裁剪的存储 key。
 * - mv：优先 `mv-{bvid}-{cid}`（分P粒度）；列表页无 cid 时用 `mv-{bvid}`（整视频粒度）
 * - audio：`audio-{sid}`
 * - local：`local-{id}`
 */
const getSongKey = (item?: SongTrimTarget): string | undefined => {
  if (!item) return undefined;
  if (item.type === "mv" && item.bvid) return item.cid ? `mv-${item.bvid}-${item.cid}` : `mv-${item.bvid}`;
  if (item.type === "audio" && item.sid !== undefined) return `audio-${item.sid}`;
  if (item.source === "local" && item.id) return `local-${item.id}`;
  return undefined;
};

interface SongTrimState {
  trims: Record<string, SongTrim>;
  /** 设置某首歌的裁剪（start/end 会钳制到非负） */
  setTrim: (item: SongTrimTarget, trim: SongTrim) => void;
  /** 读取某首歌的裁剪，未设置则返回全 0 */
  getTrim: (item?: SongTrimTarget) => SongTrim;
}

export const useSongTrim = create<SongTrimState>()(
  persist(
    (set, get) => ({
      trims: {},
      setTrim: (item, trim) => {
        const key = getSongKey(item);
        if (!key) return;
        const normalized = {
          start: Math.max(0, Number(trim.start) || 0),
          end: Math.max(0, Number(trim.end) || 0),
        };
        set(state => ({
          trims: { ...state.trims, [key]: normalized },
        }));
      },
      getTrim: item => {
        const key = getSongKey(item);
        if (!key) return { start: 0, end: 0 };
        const exact = get().trims[key];
        if (exact) return exact;
        // mv 带 cid 时优先精确分P，其次回退到整视频（bvid）级裁剪
        if (item?.type === "mv" && item.bvid && item.cid) {
          return get().trims[`mv-${item.bvid}`] || { start: 0, end: 0 };
        }
        return { start: 0, end: 0 };
      },
    }),
    {
      name: "song-trim-store",
      partialize: state => ({ trims: state.trims }),
    },
  ),
);
