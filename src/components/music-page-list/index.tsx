import React, { useMemo } from "react";

import { twMerge } from "tailwind-merge";

import Empty from "@/components/empty";
import { VirtualList } from "@/components/virtual-list";
import { usePlayList } from "@/store/play-list";

import ListItem from "./list-item";

interface Props {
  searchKeyword?: string;
  onPressItem?: VoidFunction;
  className?: string;
  hideCover?: boolean;
  itemClassName?: string;
  itemTitleClassName?: string;
  itemHeight?: number;
}

const MusicPageList = ({
  searchKeyword,
  onPressItem,
  className,
  hideCover,
  itemClassName,
  itemTitleClassName,
  itemHeight = 48,
}: Props) => {
  const playId = usePlayList(s => s.playId);
  const list = usePlayList(s => s.list);
  const currentVideoPages = usePlayList(s => s.currentVideoPages);

  const pages = useMemo(() => {
    const currentItem = list.find(item => item.id === playId);
    // 有当前视频的分P缓存且与当前视频匹配时，展示全部分P（未加入播放列表的也能看到）
    if (currentVideoPages?.length && currentItem?.bvid && currentVideoPages[0]?.bvid === currentItem.bvid) {
      return currentVideoPages;
    }
    return list.filter(item => item.bvid === currentItem?.bvid);
  }, [currentVideoPages, list, playId]);

  const filteredPages = useMemo(() => {
    if (!searchKeyword) return pages;
    const lowerKeyword = searchKeyword.toLowerCase();
    return pages.filter(item => {
      const title = item.pageTitle || item.title || "";
      return title.toLowerCase().includes(lowerKeyword);
    });
  }, [pages, searchKeyword]);

  return (
    <VirtualList
      className={twMerge("h-[60vh] w-full px-2", className)}
      data={filteredPages}
      itemHeight={itemHeight}
      overscan={5}
      empty={
        <div className="flex flex-col items-center justify-center px-4">
          <Empty className="min-h-[180px]" />
          <div className="text-foreground-500 py-3 text-sm">暂无匹配结果</div>
        </div>
      }
      renderItem={item => {
        const currentItem = list.find(i => i.id === playId);
        const isActive = Boolean(
          currentItem &&
          currentItem.bvid === item.bvid &&
          (currentItem.cid !== undefined && item.cid !== undefined
            ? currentItem.cid === item.cid
            : currentItem.id === item.id),
        );
        return (
          <ListItem
            key={item.id}
            data={item}
            isActive={isActive}
            onPressItem={onPressItem}
            hideCover={hideCover}
            className={itemClassName}
            titleClassName={itemTitleClassName}
          />
        );
      }}
    />
  );
};

export default MusicPageList;
