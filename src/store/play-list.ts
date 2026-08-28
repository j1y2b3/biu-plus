import { addToast } from "@heroui/react";
import log from "electron-log/renderer";
import { shuffle } from "es-toolkit/array";
import { remove } from "es-toolkit/array";
import { uniqueId } from "es-toolkit/compat";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

import { getPlayModeList, PlayMode } from "@/common/constants/audio";
import { getAudioUrl, getDashUrl, isUrlValid } from "@/common/utils/audio";
import { beginPlayReport, endPlayReport, reportHeartbeat } from "@/common/utils/play-report";
import { stripHtml } from "@/common/utils/str";
import { formatUrlProtocol } from "@/common/utils/url";
import { getAudioSongInfo } from "@/service/audio-song-info";
import { getWebInterfaceView } from "@/service/web-interface-view";

import { usePlayProgress } from "./play-progress";
import { useSongTrim } from "./song-trim";

export type PlayDataType = "mv" | "audio";

export interface PlayData {
  id: string;
  /** 视频标题 */
  title: string;
  /** 类型 */
  type: PlayDataType;
  /** 视频id */
  bvid?: string;
  /** 音频id */
  sid?: number;
  /** 视频aid,部分视频操作需要，例如收藏 */
  aid?: string;
  /** 视频分集id */
  cid?: string;
  /** 视频封面 */
  cover?: string;
  /** UP name */
  ownerName?: string;
  /** up mid */
  ownerMid?: number;
  /** 是否为多集视频 */
  hasMultiPart?: boolean;
  /** 分集标题 */
  pageTitle?: string;
  /** 分集封面 */
  pageCover?: string;
  /** 分集id */
  pageIndex?: number;
  /** 视频总分集数 */
  totalPage?: number;
  /** 视频时长 单位为秒 */
  duration?: number;
  /** 视频音频url */
  audioUrl?: string;
  /** 视频url */
  videoUrl?: string;
  /** 是否为无损音频 */
  isLossless?: boolean;
  /** 是否为杜比音频 */
  isDolby?: boolean;
  /** 来源 */
  source?: "local" | "online";
  /** 是否由用户从分集列表手动加入（用于区分默认只播P1与手动添加的分P） */
  manuallyAdded?: boolean;
}

interface State {
  // 播放/暂停
  isPlaying: boolean;
  // 静音
  isMuted: boolean;
  // 音量 0-1
  volume: number;
  // 播放模式
  playMode: PlayMode;
  // 播放速率（0.5x - 2.0x）
  rate: number;
  // 总时长（秒）
  duration: number | undefined;
  /** 播放队列 */
  list: PlayData[];
  /** 当前播放视频id */
  playId?: string;
  /** 下一个播放视频id */
  nextId?: string;
  /** 是否在随机播放模式下保持视频分集顺序 */
  shouldKeepPagesOrderInRandomPlayMode: boolean;
  /** 当前视频的全部分集缓存（供分集列表展示与按需添加） */
  currentVideoPages?: PlayData[];
}

export interface PlayItem {
  type: PlayDataType;
  id?: string;
  source?: "local" | "online";
  audioUrl?: string;
  title: string;
  bvid?: string;
  sid?: number;
  cover?: string;
  ownerName?: string;
  ownerMid?: number;
}

interface Action {
  togglePlay: () => void;
  toggleMute: () => void;
  setVolume: (volume: number) => void; // 0-1
  togglePlayMode: () => void;
  setRate: (rate: number) => void; // 0.5-2.0
  seek: (s: number) => void;
  setShouldKeepPagesOrderInRandomPlayMode: (shouldKeep: boolean) => void;

  init: VoidFunction;
  play: (params: PlayItem) => Promise<void>;
  playListItem: (id: string) => Promise<void>;
  /** 播放指定分集：已在播放列表则切换，否则按需加入并播放 */
  playPageItem: (item: PlayData) => void;
  playList: (items: PlayItem[]) => Promise<void>;
  addToNext: (item: PlayItem) => void;
  addList: (items: PlayItem[]) => void;
  delPage: (id: string) => void;
  del: (id: string) => void;
  clear: () => void;
  next: () => Promise<void>;
  prev: () => Promise<void>;

  getAudio: () => HTMLAudioElement;
  getPlayItem: () => PlayData | undefined;
}

const idGenerator = () => `${Date.now()}${uniqueId()}`;

const getMVData = async (bvid: string) => {
  const res = await getWebInterfaceView({ bvid });
  const hasMultiPart = (res?.data?.pages?.length ?? 0) > 1;

  return (
    res?.data?.pages?.map(item => ({
      id: idGenerator(),
      type: "mv" as PlayDataType,
      bvid,
      aid: String(res?.data?.aid),
      cid: String(item.cid),
      title: res?.data?.title,
      cover: formatUrlProtocol(res?.data?.pic),
      ownerName: res?.data?.owner?.name,
      ownerMid: res?.data?.owner?.mid,
      hasMultiPart,

      pageIndex: item.page,
      pageTitle: hasMultiPart ? item.part : res?.data?.title,
      pageCover: hasMultiPart
        ? formatUrlProtocol(item.first_frame || res?.data?.pic)
        : formatUrlProtocol(res?.data?.pic),
      totalPage: res?.data?.pages?.length,
      duration: item.duration,
    })) || []
  );
};

const getAudioData = async (sid: number) => {
  const res = await getAudioSongInfo({ sid });

  return [
    {
      id: idGenerator(),
      type: "audio" as PlayDataType,
      sid,
      title: res?.data?.title || "",
      cover: formatUrlProtocol(res?.data?.cover || ""),
      duration: res?.data?.duration || 0,
      ownerName: res?.data?.author || "",
      ownerMid: res?.data?.uid || 0,
    },
  ];
};

const toastError = (title: string) => {
  addToast({
    title,
    color: "danger",
  });
};

const sanitizeTitle = (title: string) => stripHtml(title);

const handlePlayError = (error: any) => {
  const errorMsg = error?.message || error?.name || "";
  if (!errorMsg.includes("interrupted") && !errorMsg.includes("NotAllowed")) {
    toastError(error instanceof Error ? error.message : "获取播放链接失败");
  }
};

const updateMediaSession = ({ title, artist, cover }: { title: string; artist?: string; cover?: string }) => {
  if ("mediaSession" in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title,
      artist,
      artwork: cover ? [{ src: cover }] : [],
    });
  }
};

const createAudio = (): HTMLAudioElement => {
  const audio = new Audio();
  audio.preload = "metadata";
  audio.controls = false;
  audio.crossOrigin = "anonymous";
  return audio;
};

export const audio = createAudio();

/** 播放出错/卡住时的最大自动恢复次数 */
const MAX_AUDIO_ERROR_RETRY = 3;
/** 播放卡住（数据迟迟不到）的判定时间（ms） */
const STALL_TIMEOUT = 8000;
let audioErrorRetryCount = 0;
let stallTimerId: number | null = null;

/** 获取播放链接失败时的最大重试次数 */
const AUDIO_FETCH_RETRY = 2;
/** 获取播放链接重试间隔（ms） */
const AUDIO_FETCH_RETRY_DELAY = 1000;

const wait = (ms: number) => new Promise<void>(resolve => window.setTimeout(resolve, ms));

const updatePlaybackState = () => {
  if ("mediaSession" in navigator) {
    navigator.mediaSession.playbackState = audio.paused ? "paused" : "playing";
  }

  if (window.electron && window.electron.updatePlaybackState) {
    window.electron.updatePlaybackState(!audio.paused);
  }
};

const playAudioSafely = async () => {
  try {
    await audio.play();
  } catch (error) {
    if ((error as DOMException)?.name === "NotSupportedError") {
      const refreshed = await refreshCurrentAudioSource();
      if (refreshed) {
        try {
          await audio.play();
          return;
        } catch (retryError) {
          handlePlayError(retryError);
          return;
        }
      }
      return;
    }
    handlePlayError(error);
  }
};

const updatePositionState = () => {
  if ("mediaSession" in navigator) {
    const dur = audio.duration;
    if (!Number.isNaN(dur) && dur !== Infinity) {
      navigator.mediaSession.setPositionState({
        duration: dur,
        playbackRate: audio.playbackRate,
        position: audio.currentTime,
      });
    }
  }
};

export const isSame = (
  item1?: { type: "mv" | "audio"; sid?: number; bvid?: string; source?: "local" | "online"; id?: string },
  item2?: { type: "mv" | "audio"; sid?: number; bvid?: string; source?: "local" | "online"; id?: string },
) => {
  if (!item1 || !item2) {
    return false;
  }
  if (item1.source === "local" || item2.source === "local") {
    return Boolean(item1.id) && Boolean(item2.id) && item1.id === item2.id;
  }
  if (item1.type !== item2.type) {
    return false;
  }
  if (item1.type === "mv") {
    return Boolean(item1.bvid) && Boolean(item2.bvid) && item1.bvid === item2.bvid;
  }
  if (item1.type === "audio") {
    return item1.sid !== undefined && item2.sid !== undefined && item1.sid === item2.sid;
  }
  return false;
};

const shouldReportPlayRecord = (item?: { type: PlayDataType; source?: "local" | "online" }) =>
  item?.type === "mv" && item?.source !== "local";

export const usePlayList = create<State & Action>()(
  persist(
    immer((set, get) => {
      const ensureAudioSrcValid = async () => {
        const { playId, list } = get();
        const currentPlayItem = list.find(item => item.id === playId);
        if (currentPlayItem?.source === "local" && currentPlayItem?.audioUrl) {
          if (audio.src !== currentPlayItem.audioUrl) {
            audio.src = currentPlayItem.audioUrl;
          }
          const currentTime = usePlayProgress.getState().currentTime;
          if (typeof currentTime === "number" && currentTime > 0) {
            audio.currentTime = currentTime;
          }
          return;
        }
        if (isUrlValid(currentPlayItem?.audioUrl)) {
          if (audio.src !== currentPlayItem.audioUrl) {
            audio.src = currentPlayItem.audioUrl;
          }
          const currentTime = usePlayProgress.getState().currentTime;
          if (typeof currentTime === "number" && currentTime > 0) {
            audio.currentTime = currentTime;
          }
          return;
        }

        if (currentPlayItem?.type === "mv" && currentPlayItem?.bvid && currentPlayItem?.cid) {
          // 获取播放链接失败时自动重试，避免“下一首播放不了”
          let mvPlayData: Awaited<ReturnType<typeof getDashUrl>> | undefined;
          for (let attempt = 0; attempt <= AUDIO_FETCH_RETRY; attempt += 1) {
            mvPlayData = await getDashUrl(currentPlayItem.bvid, currentPlayItem.cid);
            if (mvPlayData?.audioUrl) {
              break;
            }
            if (attempt < AUDIO_FETCH_RETRY) {
              log.warn(`[播放] 获取视频音频链接失败，第 ${attempt + 1} 次重试`, {
                title: currentPlayItem.title,
              });
              await wait(AUDIO_FETCH_RETRY_DELAY);
            }
          }
          if (mvPlayData?.audioUrl) {
            if (audio.src !== mvPlayData.audioUrl) {
              audio.src = mvPlayData.audioUrl;
              const currentTime = usePlayProgress.getState().currentTime;
              if (typeof currentTime === "number") {
                audio.currentTime = currentTime;
              }
            }
            set(state => {
              const listItem = state.list.find(item => item.id === state.playId);
              if (listItem) {
                listItem.audioUrl = mvPlayData.audioUrl;
                listItem.videoUrl = mvPlayData.videoUrl;
                listItem.isLossless = mvPlayData.isLossless;
                listItem.isDolby = mvPlayData.isDolby;
              }
            });
          } else {
            log.error("无法获取音频播放链接", {
              type: "mv",
              bvid: currentPlayItem.bvid,
              cid: currentPlayItem.cid,
              title: currentPlayItem.title,
              mvPlayData,
            });
            toastError("无法获取音频播放链接");
          }
        }

        if (currentPlayItem?.type === "audio" && currentPlayItem?.sid) {
          // 获取播放链接失败时自动重试，避免“下一首播放不了”
          let musicPlayData: Awaited<ReturnType<typeof getAudioUrl>> | undefined;
          for (let attempt = 0; attempt <= AUDIO_FETCH_RETRY; attempt += 1) {
            musicPlayData = await getAudioUrl(currentPlayItem.sid);
            if (musicPlayData?.audioUrl) {
              break;
            }
            if (attempt < AUDIO_FETCH_RETRY) {
              log.warn(`[播放] 获取音频链接失败，第 ${attempt + 1} 次重试`, {
                title: currentPlayItem.title,
              });
              await wait(AUDIO_FETCH_RETRY_DELAY);
            }
          }
          if (musicPlayData?.audioUrl) {
            if (audio.src !== musicPlayData.audioUrl) {
              audio.src = musicPlayData.audioUrl;
              const currentTime = usePlayProgress.getState().currentTime;
              if (typeof currentTime === "number") {
                audio.currentTime = currentTime;
              }
            }
            set(state => {
              const listItem = state.list.find(item => item.id === state.playId);
              if (listItem) {
                listItem.audioUrl = musicPlayData.audioUrl;
                listItem.isLossless = musicPlayData.isLossless;
              }
            });
          } else {
            log.error("无法获取音频播放链接", {
              type: "audio",
              sid: currentPlayItem.sid,
              title: currentPlayItem.title,
              musicPlayData,
            });
            toastError("无法获取音频播放链接");
          }
        }
      };

      return {
        isPlaying: false,
        isMuted: false,
        volume: 0.5,
        playMode: PlayMode.Loop,
        rate: 1,
        duration: undefined,
        shouldKeepPagesOrderInRandomPlayMode: true,
        list: [],
        init: async () => {
          if (audio) {
            audio.volume = get().volume;
            audio.muted = get().isMuted;
            audio.playbackRate = get().rate;
            audio.loop = get().playMode === PlayMode.Single;

            const clearStallTimer = () => {
              if (stallTimerId !== null) {
                window.clearTimeout(stallTimerId);
                stallTimerId = null;
              }
            };

            const scheduleStallRecovery = () => {
              // 数据迟迟不到视为卡住，超时后刷新播放链接恢复
              clearStallTimer();
              stallTimerId = window.setTimeout(() => {
                const playItem = get().getPlayItem?.();
                if (!playItem) return;
                const position = audio.currentTime || 0;
                log.warn("[播放恢复] 播放卡住，刷新链接", {
                  title: playItem.title,
                  position,
                });
                void (async () => {
                  const refreshed = await refreshCurrentAudioSource();
                  if (refreshed) {
                    if (position > 0.5) {
                      audio.currentTime = position;
                    }
                    await playAudioSafely();
                  }
                })();
              }, STALL_TIMEOUT);
            };

            const handleAudioError = () => {
              const playItem = get().getPlayItem?.();
              if (!playItem) {
                return;
              }
              if (audioErrorRetryCount >= MAX_AUDIO_ERROR_RETRY) {
                audioErrorRetryCount = 0;
                log.error("[播放恢复] 播放出错且多次重试仍未恢复", {
                  title: playItem.title,
                  errorCode: audio.error?.code,
                });
                handlePlayError(new Error("播放中断，多次重试仍未恢复"));
                return;
              }
              audioErrorRetryCount += 1;
              const position = audio.currentTime || 0;
              const wasPlaying = !audio.paused;
              log.warn("[播放恢复] 播放出错，刷新链接重试", {
                title: playItem.title,
                retry: audioErrorRetryCount,
                position,
                errorCode: audio.error?.code,
              });
              void (async () => {
                const refreshed = await refreshCurrentAudioSource();
                if (!refreshed) {
                  audioErrorRetryCount = 0;
                  return;
                }
                if (position > 0.5) {
                  audio.currentTime = position;
                }
                if (wasPlaying) {
                  await playAudioSafely();
                } else {
                  audioErrorRetryCount = 0;
                }
                // 只有真正恢复（播放位置前进了）才重置重试计数，否则保持计数以触发上限，避免无限重试
                window.setTimeout(() => {
                  if (audio.currentTime > position + 2) {
                    audioErrorRetryCount = 0;
                  }
                }, 3000);
              })();
            };

            audio.onplaying = () => {
              clearStallTimer();
            };

            audio.onstalled = scheduleStallRecovery;
            audio.onwaiting = scheduleStallRecovery;
            audio.onerror = handleAudioError;

            audio.ondurationchange = () => {
              const dur = audio.duration;
              if (!Number.isNaN(dur) && dur !== Infinity) {
                set({ duration: Math.round(dur * 100) / 100 });
                updatePositionState();
              }
            };

            const handleTrackEnd = () => {
              const playItem = get().getPlayItem?.();
              if (shouldReportPlayRecord(playItem)) {
                void reportHeartbeat(playItem, audio.duration, audio.duration, 4);
                endPlayReport();
              }

              const currentIndex = get().list.findIndex(item => item.id === get().playId);
              if (get().playMode === PlayMode.Sequence && currentIndex === get().list.length - 1) {
                audio.currentTime = 0;
                audio.pause();
                return;
              }

              get().next();
            };

            audio.ontimeupdate = () => {
              clearStallTimer();
              const currentTime = Math.round(audio.currentTime * 100) / 100;
              usePlayProgress.getState().setCurrentTime(currentTime);
              const playItem = get().getPlayItem?.();
              if (shouldReportPlayRecord(playItem)) {
                void reportHeartbeat(playItem, currentTime, audio.duration, 0);
              }

              // 单曲裁剪：到达裁剪后的结尾时视为播完
              const trim = useSongTrim.getState().getTrim(playItem);
              if (
                trim.end > 0 &&
                Number.isFinite(audio.duration) &&
                audio.currentTime >= audio.duration - trim.end - 0.2
              ) {
                if (get().playMode === PlayMode.Single) {
                  audio.currentTime = trim.start > 0 ? trim.start : 0;
                  return;
                }
                handleTrackEnd();
              }
            };

            audio.onseeked = () => {
              updatePositionState();
            };

            audio.onratechange = () => {
              updatePositionState();
            };

            audio.onplay = () => {
              set({ isPlaying: true });
              updatePlaybackState();
              updatePositionState();
              const playItem = get().getPlayItem?.();
              if (shouldReportPlayRecord(playItem)) {
                void reportHeartbeat(playItem, audio.currentTime, audio.duration, 1);
              }
            };

            audio.onpause = () => {
              set({ isPlaying: false });
              updatePlaybackState();
              updatePositionState();
              const playItem = get().getPlayItem?.();
              if (shouldReportPlayRecord(playItem)) {
                void reportHeartbeat(playItem, audio.currentTime, audio.duration, 2);
              }
            };

            audio.onended = () => {
              if (get().playMode === PlayMode.Single) {
                return;
              }
              handleTrackEnd();
            };

            if ("mediaSession" in navigator) {
              navigator.mediaSession.setActionHandler("play", () => get().togglePlay());
              navigator.mediaSession.setActionHandler("pause", () => get().togglePlay());
              navigator.mediaSession.setActionHandler("previoustrack", () => get().prev());
              navigator.mediaSession.setActionHandler("nexttrack", () => {
                if (get().list.length > 1) {
                  get().next();
                }
              });
              navigator.mediaSession.setActionHandler("seekto", details => {
                if (details.seekTime) get().seek(Math.round(details.seekTime * 100) / 100);
                updatePositionState();
              });
              navigator.mediaSession.setActionHandler("seekbackward", details => {
                const offset = details?.seekOffset || 10;
                get().seek(Math.round((audio.currentTime - offset) * 100) / 100);
              });
              navigator.mediaSession.setActionHandler("seekforward", details => {
                const offset = details?.seekOffset || 10;
                get().seek(Math.round((audio.currentTime + offset) * 100) / 100);
              });
            }

            if (get().playId) {
              const playItem = get().list.find(item => item.id === get().playId);
              if (playItem) {
                await ensureAudioSrcValid();

                const localCurrentTime = usePlayProgress.getState().initCurrentTime();
                if (localCurrentTime) {
                  audio.currentTime = localCurrentTime;
                }

                updateMediaSession({
                  title: playItem.title,
                  artist: playItem.ownerName,
                  cover: playItem.pageCover || playItem.cover,
                });
              }
            }
          }
        },
        toggleMute: () => {
          if (audio) {
            audio.muted = !audio.muted;
          }
          set(s => ({ isMuted: !s.isMuted }));
        },
        setVolume: volume => {
          if (audio) {
            audio.volume = volume;
          }
          set(state => {
            state.volume = volume;
          });
        },
        togglePlayMode: () => {
          const playModeList = getPlayModeList();
          const currentIndex = playModeList.findIndex(item => item.value === get().playMode);
          const nextIndex = (currentIndex + 1) % playModeList.length;
          const nextPlayMode = playModeList[nextIndex].value;

          if (audio) {
            audio.loop = nextPlayMode === PlayMode.Single;
          }
          set(state => {
            state.playMode = nextPlayMode;
          });
        },
        setRate: rate => {
          if (audio) {
            audio.playbackRate = rate;
          }
          set(state => {
            state.rate = rate;
          });
        },
        seek: s => {
          const playItem = get().getPlayItem();
          const trim = useSongTrim.getState().getTrim(playItem);
          const end = Number.isFinite(audio.duration) ? audio.duration - trim.end : s;
          const clamped = Math.min(Math.max(s, trim.start), end);
          usePlayProgress.getState().setCurrentTime(clamped);
          if (audio) {
            audio.currentTime = clamped;
          }
        },
        togglePlay: async () => {
          if (!get().list?.length) {
            return;
          }

          if (!get().playId) {
            return;
          }

          if (audio.paused) {
            set(state => {
              state.isPlaying = true;
            });
            await ensureAudioSrcValid();
            await playAudioSafely();
          } else {
            audio.pause();
            set(state => {
              state.isPlaying = false;
            });
          }
        },
        setShouldKeepPagesOrderInRandomPlayMode: shouldKeep => {
          set({ shouldKeepPagesOrderInRandomPlayMode: shouldKeep });
        },
        play: async ({ type, bvid, sid, title, cover, ownerName, ownerMid, id, source, audioUrl }: PlayItem) => {
          const { list, playId } = get();
          const currentItem = list?.find(item => item.id === playId);
          const sanitizedTitle = sanitizeTitle(title);
          const candidate = { type, bvid, sid, source, id };
          const isLocal = source === "local";

          // 多P视频：始终重置到第一个分P（P1），并清理播放列表中该视频的其它分P。
          // 即使当前正播的是同一视频的P2/Pn（旧残留或手动添加），点播也会回到P1，
          // 避免默认连播/停留在伴奏等分集。
          if (type === "mv" && bvid && !isLocal) {
            // 当前正播同一视频的P1且仅需恢复播放时，清理其它分P后恢复
            const isCurrentP1 = currentItem && isSame(currentItem, candidate) && currentItem.pageIndex === 1;
            if (isCurrentP1) {
              set(state => {
                state.list = state.list.filter(
                  item => !(item.type === "mv" && item.bvid === bvid) || item.id === currentItem.id,
                );
                if (state.nextId && !state.list.some(item => item.id === state.nextId)) {
                  state.nextId = undefined;
                }
              });
              if (audio.paused) {
                await ensureAudioSrcValid();
                await playAudioSafely();
              }
              return;
            }

            const mvPages = await getMVData(bvid);
            set(state => {
              state.currentVideoPages = mvPages;
            });
            if (mvPages.length === 0) {
              toastError("播放失败：无法获取播放信息");
              return;
            }
            set(state => {
              state.list = state.list.filter(item => !(item.type === "mv" && item.bvid === bvid));
              state.list.push(mvPages[0]);
              state.playId = mvPages[0].id;
              if (state.nextId && !state.list.some(item => item.id === state.nextId)) {
                state.nextId = undefined;
              }
            });
            return;
          }

          // 当前正在播放（音频/本地等），如果暂停了则播放
          if (isSame(currentItem, candidate)) {
            if (audio.paused) {
              await ensureAudioSrcValid();
              await playAudioSafely();
            }
            return;
          }

          // 列表已存在（音频/本地等）
          const existItem = list?.find(item => isSame(item, candidate));
          if (existItem) {
            set({ playId: existItem.id });
            try {
              await ensureAudioSrcValid();
              await playAudioSafely();
            } catch (error) {
              handlePlayError(error);
            }
            return;
          }

          let playItem: PlayData[];

          if (isLocal && id) {
            playItem = [
              {
                id,
                type,
                source,
                audioUrl,
                title: sanitizedTitle,
              },
            ];
          } else if (type === "audio" && sid && (!cover || !ownerName || !ownerMid)) {
            playItem = await getAudioData(sid);
          } else {
            playItem = [
              {
                id: idGenerator(),
                type,
                bvid,
                sid,
                title: sanitizedTitle,
                cover: cover ? formatUrlProtocol(cover) : undefined,
                ownerName,
                ownerMid,
              },
            ];
          }

          const nextPlayItem = playItem[0];
          if (!nextPlayItem) {
            toastError("播放失败：无法获取播放信息");
            return;
          }

          set(state => {
            state.list = [...state.list, ...playItem];
            state.playId = nextPlayItem.id;
          });
        },
        playListItem: async (id: string) => {
          if (get().playId === id) {
            return;
          }

          const item = get().list.find(i => i.id === id);
          set(state => {
            state.playId = id;
            if (state.nextId === id) {
              state.nextId = undefined;
            }
          });

          // 切换到其它多P视频时刷新分集缓存，保证分集列表完整
          if (item?.type === "mv" && item?.bvid && get().currentVideoPages?.[0]?.bvid !== item.bvid) {
            const mvPages = await getMVData(item.bvid);
            set(state => {
              state.currentVideoPages = mvPages;
            });
          }
        },
        playPageItem: item => {
          const { list } = get();
          // 已在播放列表中则直接切换，否则按需加入并播放
          const exist = list.find(i =>
            i.source === "local"
              ? Boolean(i.id) && i.id === item.id
              : i.type === item.type && i.bvid === item.bvid && i.cid === item.cid,
          );
          if (exist) {
            set({ playId: exist.id });
            return;
          }
          const newItem = { ...item, id: idGenerator(), manuallyAdded: true };
          set(state => {
            state.list.push(newItem);
            state.playId = newItem.id;
          });
        },
        playList: async items => {
          const newList = items.map(item => ({
            ...item,
            title: sanitizeTitle(item.title),
            id: item.source === "local" && item.id ? item.id : idGenerator(),
          }));

          set(state => {
            state.list = newList;
            state.playId = newList[0].id;
            state.currentVideoPages = undefined;
          });
        },
        next: async () => {
          const { playMode, list, playId, nextId, shouldKeepPagesOrderInRandomPlayMode } = get();

          if (!list?.length) {
            return;
          }

          if (!playId) {
            return;
          }

          if (nextId) {
            set(state => {
              state.playId = nextId;
              state.nextId = undefined;
            });
            return;
          }

          const currentIndex = list.findIndex(item => item.id === playId);
          // 计算“下一首”索引：默认跳过同一多P视频中未手动添加的分P（如伴奏），
          // 避免旧的展开结果/持久化残留导致自动连播
          const nextIndex = (() => {
            const currentItem = list[currentIndex];
            const total = list.length;
            let index = (currentIndex + 1) % total;
            let guard = 0;
            while (guard < total) {
              const candidate = list[index];
              const isUnaddedPage =
                currentItem?.type === "mv" &&
                candidate?.type === "mv" &&
                candidate.bvid === currentItem.bvid &&
                candidate.cid !== currentItem.cid &&
                !candidate.manuallyAdded;
              if (!isUnaddedPage) {
                return index;
              }
              index = (index + 1) % total;
              guard += 1;
            }
            return (currentIndex + 1) % total;
          })();
          switch (playMode) {
            case PlayMode.Sequence:
            case PlayMode.Single:
            case PlayMode.Loop: {
              if (list.length === 1) {
                audio.currentTime = 0;
                await playAudioSafely();
                break;
              }

              set(state => {
                state.playId = list[nextIndex].id;
              });
              break;
            }
            case PlayMode.Random: {
              const currentPlayItem = list[currentIndex];

              if (list.length === 1) {
                audio.currentTime = 0;
                await playAudioSafely();
                break;
              }

              // 保持分集顺序，且当前为分集视频，且不是最后一集
              if (
                shouldKeepPagesOrderInRandomPlayMode &&
                currentPlayItem.pageIndex &&
                currentPlayItem.pageIndex !== currentPlayItem.totalPage
              ) {
                const nextPage = list.find(
                  item => item.bvid === currentPlayItem.bvid && item.pageIndex === currentPlayItem.pageIndex! + 1,
                );
                if (nextPage) {
                  set({ playId: nextPage.id });
                  break;
                }
              }

              const shuffledList = shuffle(list?.map(item => item.id));
              const currentIndexInShuffled = shuffledList.findIndex(shuffled => shuffled === playId);
              const nextShuffledIndex = (currentIndexInShuffled + 1) % shuffledList.length;
              set(state => {
                state.playId = shuffledList[nextShuffledIndex];
              });
              break;
            }
          }
        },
        prev: async () => {
          const { playId, list } = get();

          if (!list?.length) {
            return;
          }

          if (!playId) {
            return;
          }

          const currentIndex = list.findIndex(item => item.id === playId);
          if (currentIndex === -1) return;

          const prevIndex = (currentIndex - 1 + list.length) % list.length;

          set(state => {
            state.playId = list[prevIndex].id;
          });
        },
        addToNext: async ({ type, title, bvid, sid, cover, ownerName, ownerMid, id, source, audioUrl }) => {
          const { playId, nextId: currentNextId, list } = get();
          const currentItem = list.find(item => item.id === playId);
          const sanitizedTitle = sanitizeTitle(title);
          const candidate = { type, bvid, sid, source, id };
          // 如果当前正在播放，则不添加
          if (isSame(candidate, currentItem)) {
            return;
          }

          // 如果下一首就是要添加的，则不添加
          if (currentNextId) {
            const currentNextItem = list.find(item => item.id === currentNextId);
            if (isSame(candidate, currentNextItem)) {
              return;
            }
          }

          // 列表已存在
          const existItemIndex = list?.findIndex(item => isSame(item, candidate)) ?? -1;
          if (existItemIndex !== -1) {
            set(state => {
              state.nextId = list[existItemIndex].id;
              // 将已存在项移动到下一首
              const currentItemIndex = list.findIndex(item => item.id === playId);
              if (currentItemIndex !== existItemIndex - 1) {
                state.list.splice(existItemIndex, 1);
                state.list.splice(currentItemIndex, 0, list[existItemIndex]);
              }
            });
            return;
          }

          let nextPlayItem: PlayData[];

          if (source === "local" && id) {
            nextPlayItem = [
              {
                id,
                type,
                bvid,
                sid,
                source,
                audioUrl,
                title: sanitizedTitle,
                cover: cover ? formatUrlProtocol(cover) : undefined,
                ownerName,
                ownerMid,
              },
            ];
          } else if (type === "mv" && bvid) {
            // 多P视频：默认只加入第一个分P，其余分P在分集列表中按需添加
            const mvPages = await getMVData(bvid);
            set(state => {
              state.currentVideoPages = mvPages;
            });
            nextPlayItem = mvPages.length > 0 ? [mvPages[0]] : [];
          } else if (type === "audio" && sid && (!cover || !ownerName || !ownerMid)) {
            nextPlayItem = await getAudioData(sid);
          } else {
            nextPlayItem = [
              {
                id: idGenerator(),
                type,
                bvid,
                sid,
                title: sanitizedTitle,
                cover: cover ? formatUrlProtocol(cover) : undefined,
                ownerName,
                ownerMid,
              },
            ];
          }

          if (!nextPlayItem || nextPlayItem.length === 0) {
            toastError("添加失败：无法获取播放信息");
            return;
          }

          const nextId = nextPlayItem[0].id;
          // 空列表，直接播放
          if (list.length === 0) {
            set({
              playId: nextId,
              list: nextPlayItem,
            });
            return;
          }

          // 当前播放的是音频，则直接插入到其后面
          if (currentItem?.type === "audio") {
            set(state => {
              state.nextId = nextId;
              const currentItemIndex = list.findIndex(item => item.id === state.playId);
              state.list.splice(currentItemIndex + 1, 0, ...nextPlayItem);
            });
          }

          // 当前播放的是视频，找到最后一个分集的索引，插入到其后面
          if (currentItem?.type === "mv") {
            const currentMVLastPageIndex = list.findLastIndex(item =>
              isSame(item, { type: "mv", bvid: currentItem.bvid }),
            );
            set(state => {
              state.nextId = nextId;
              state.list.splice(currentMVLastPageIndex + 1, 0, ...nextPlayItem);
            });
          }
        },
        addList: async items => {
          const { list, playId } = get();
          if (list.length === 0) {
            get().playList(items);
            return;
          }

          const currentItem = list.find(item => item.id === playId);

          const paddingItems = items
            .filter(item => {
              if (currentItem && isSame(item, currentItem)) {
                return false;
              }
              return !list.some(existing => isSame(existing, item));
            })
            .map(item => ({
              ...item,
              title: sanitizeTitle(item.title),
              id: item.source === "local" && item.id ? item.id : idGenerator(),
            }));

          if (paddingItems.length === 0) {
            return;
          }

          set({
            list: [...list, ...paddingItems],
          });
        },
        delPage: async id => {
          const { list } = get();
          if (!list.some(item => item.id === id)) {
            return;
          }

          if (list.length === 1) {
            get().clear();
            return;
          }

          if (id === get().playId) {
            try {
              await get().next();
            } catch (error) {
              handlePlayError(error);
            }
          }

          set(state => {
            const removeIndex = state.list.findIndex(item => item.id === id);
            if (removeIndex !== -1) {
              state.list.splice(removeIndex, 1);
            }
          });
        },
        del: async id => {
          if (get().list.length === 1) {
            get().clear();
            return;
          }

          const { playId, list } = get();
          const playItem = list.find(item => item.id === playId);
          const removedItem = list.find(item => item.id === id);

          if (isSame(playItem, removedItem)) {
            if (removedItem?.type === "audio") {
              try {
                await get().next();
              } catch (error) {
                handlePlayError(error);
              }
            } else {
              if (list.some(item => !isSame(item, removedItem))) {
                const lastIndex = list.findLastIndex(item => isSame(item, removedItem));
                if (lastIndex !== -1) {
                  const nextPlayIndex = (lastIndex + 1) % list.length;
                  set(state => {
                    state.playId = state.list[nextPlayIndex].id;
                  });
                }
              } else {
                get().clear();
                return;
              }
            }
          }

          set(state => {
            remove(state.list, item => isSame(item, removedItem));
          });
        },
        clear: () => {
          const currentPlayItem = get().getPlayItem?.();
          if (shouldReportPlayRecord(currentPlayItem)) {
            endPlayReport();
          }
          if (audio) {
            audio.src = "";
            if (!audio.paused) {
              audio.pause();
            }
          }
          set(state => {
            state.isPlaying = false;
            state.duration = undefined;
            state.list = [];
            state.playId = undefined;
            state.nextId = undefined;
            state.currentVideoPages = undefined;
          });
          usePlayProgress.getState().setCurrentTime(0);
        },
        getPlayItem: () => {
          const { playId, list } = get();
          const playItem = list.find(item => item.id === playId);
          return playItem;
        },
        getAudio: () => audio,
      };
    }),
    {
      name: "play-list-store",
      partialize: state => ({
        isMuted: state.isMuted,
        volume: state.volume,
        playMode: state.playMode,
        rate: state.rate,
        duration: state.duration,
        list: state.list,
        playId: state.playId,
        nextId: state.nextId,
        shouldKeepPagesOrderInRandomPlayMode: state.shouldKeepPagesOrderInRandomPlayMode,
      }),
    },
  ),
);

async function refreshCurrentAudioSource(): Promise<boolean> {
  const { getPlayItem } = usePlayList.getState?.() ?? {};
  const playItem = getPlayItem?.();

  if (!playItem) {
    return false;
  }

  try {
    if (playItem.type === "mv" && playItem.bvid && playItem.cid) {
      const mvPlayData = await getDashUrl(playItem.bvid, playItem.cid);
      if (mvPlayData?.audioUrl) {
        audio.src = mvPlayData.audioUrl;
        usePlayList.setState(state => {
          const listItem = state.list.find(item => item.id === state.playId);
          if (listItem) {
            listItem.audioUrl = mvPlayData.audioUrl;
            listItem.videoUrl = mvPlayData.videoUrl;
            listItem.isLossless = mvPlayData.isLossless;
            listItem.isDolby = mvPlayData.isDolby;
          }
        });
        return true;
      }
    }

    if (playItem.type === "audio" && playItem.sid) {
      const musicPlayData = await getAudioUrl(playItem.sid);
      if (musicPlayData?.audioUrl) {
        audio.src = musicPlayData.audioUrl;
        usePlayList.setState(state => {
          const listItem = state.list.find(item => item.id === state.playId);
          if (listItem) {
            listItem.audioUrl = musicPlayData.audioUrl;
            listItem.isLossless = musicPlayData.isLossless;
          }
        });
        return true;
      }
    }
  } catch (refreshError) {
    log.error("刷新播放链接失败", {
      playItem,
      refreshError,
    });
    handlePlayError(refreshError);
  }

  return false;
}

function resetAudioAndPlay(url: string) {
  audio.src = url;
  audio.currentTime = 0;
  audio.load();

  // 单曲裁剪：从头跳过指定秒数（等可播放后再定位到裁剪起点）
  const playItem = usePlayList.getState().getPlayItem?.();
  const trim = useSongTrim.getState().getTrim(playItem);
  if (trim.start > 0) {
    const onCanPlay = () => {
      audio.removeEventListener("canplay", onCanPlay);
      if (audio.currentTime < trim.start) {
        audio.currentTime = trim.start;
      }
    };
    audio.addEventListener("canplay", onCanPlay);
  }

  void playAudioSafely();
}

// 切换歌曲时，更新当前播放的歌曲信息
usePlayList.subscribe(async (state, prevState) => {
  if (state.playId !== prevState.playId) {
    audioErrorRetryCount = 0;
    if (!state.playId) {
      const prevPlayItem = prevState.list.find(item => item.id === prevState.playId);
      if (shouldReportPlayRecord(prevPlayItem)) {
        endPlayReport();
      }
    }

    if (audio && !audio.paused) {
      audio.pause();
      audio.currentTime = 0;
    }
    // 切换歌曲
    if (state.playId) {
      const playItem = state.list.find(item => item.id === state.playId);
      if (playItem) {
        if (shouldReportPlayRecord(playItem)) {
          void beginPlayReport(playItem);
        }
      }
      if (playItem?.source === "local" && playItem?.audioUrl && audio.paused) {
        resetAudioAndPlay(playItem.audioUrl);
        return;
      }
      if (isUrlValid(playItem?.audioUrl) && audio.paused) {
        resetAudioAndPlay(playItem.audioUrl);
        return;
      }

      if (playItem?.type === "mv") {
        if (playItem?.bvid && playItem?.cid) {
          const mvPlayData = await getDashUrl(playItem.bvid, playItem.cid);
          if (mvPlayData?.audioUrl) {
            resetAudioAndPlay(mvPlayData?.audioUrl);

            updateMediaSession({
              title: playItem.pageTitle || playItem.title,
              artist: playItem.ownerName,
              cover: playItem.pageCover || playItem.cover,
            });

            usePlayList.setState(state => {
              const listItem = state.list.find(item => item.id === state.playId);
              if (listItem) {
                listItem.audioUrl = mvPlayData?.audioUrl;
                listItem.videoUrl = mvPlayData?.videoUrl;
                listItem.isLossless = mvPlayData?.isLossless;
                listItem.isDolby = mvPlayData?.isDolby;
              }
            });
          } else {
            log.error("无法获取音频播放链接", {
              type: "mv",
              bvid: playItem.bvid,
              cid: playItem.cid,
              title: playItem.title,
              mvPlayData,
            });
            toastError("无法获取音频播放链接");
          }
        } else if (playItem?.bvid) {
          const mvData = await getMVData(playItem.bvid);
          const [firstMV, ...restMV] = mvData;
          if (firstMV?.cid) {
            const mvPlayData = await getDashUrl(playItem.bvid, firstMV.cid);
            if (mvPlayData?.audioUrl) {
              resetAudioAndPlay(mvPlayData?.audioUrl);

              updateMediaSession({
                title: firstMV.pageTitle || firstMV.title,
                artist: firstMV.ownerName,
                cover: firstMV.pageCover || firstMV.cover,
              });

              usePlayList.setState(state => {
                const listItemIndex = state.list.findIndex(item => item.id === state.playId);
                state.list.splice(
                  listItemIndex,
                  1,
                  {
                    ...firstMV,
                    ...{
                      audioUrl: mvPlayData?.audioUrl,
                      videoUrl: mvPlayData?.videoUrl,
                      isLossless: mvPlayData?.isLossless,
                      isDolby: mvPlayData?.isDolby,
                    },
                  },
                  ...restMV,
                );
                state.playId = firstMV.id;
              });
            } else {
              log.error("无法获取音频播放链接", {
                type: "mv",
                bvid: playItem.bvid,
                cid: firstMV.cid,
                title: firstMV.title,
                mvPlayData,
              });
              toastError("无法获取音频播放链接");
            }
          } else {
            log.error("无法获取音频播放链接", {
              type: "mv",
              bvid: playItem.bvid,
              title: playItem.title,
              mvData,
            });
            toastError("无法获取音频播放链接");
          }
        }
      }

      if (playItem?.type === "audio" && playItem?.sid) {
        const musicPlayData = await getAudioUrl(playItem.sid);
        if (musicPlayData?.audioUrl) {
          resetAudioAndPlay(musicPlayData?.audioUrl);

          updateMediaSession({
            title: playItem.title,
            artist: playItem.ownerName,
            cover: playItem.pageCover || playItem.cover,
          });

          usePlayList.setState(state => {
            const listItem = state.list.find(item => item.id === state.playId);
            if (listItem) {
              listItem.audioUrl = musicPlayData?.audioUrl;
            }
          });
        } else {
          log.error("无法获取音频播放链接", {
            type: "audio",
            sid: playItem.sid,
            title: playItem.title,
            musicPlayData,
          });
          toastError("无法获取音频播放链接");
        }
      }
    }
  }
});
