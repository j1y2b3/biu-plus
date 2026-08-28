import { useCallback, useState } from "react";

import { useRequest } from "ahooks";

import { getWebDynamicFeedAllUpdate } from "@/service/web-dynamic";

/**
 * 轮询检测是否有新动态，返回新动态数量（0 表示没有新动态）与清零方法。
 * @param enabled 是否启用轮询（未登录时传入 false 则不请求）
 */
const useDynamicUpdateCount = (enabled: boolean) => {
  const [updateCount, setUpdateCount] = useState(0);

  useRequest(
    async () => {
      const res = await getWebDynamicFeedAllUpdate({
        type: "video",
        update_baseline: 0,
        web_location: "333.1365",
      });
      return res;
    },
    {
      ready: enabled,
      pollingInterval: 300000,
      pollingWhenHidden: false,
      onSuccess: res => {
        if (res.code === 0) {
          setUpdateCount(res.data?.update_num ?? 0);
        }
      },
      onError: () => {
        setUpdateCount(0);
      },
    },
  );

  /** 点击动态入口后清零提示 */
  const reset = useCallback(() => {
    setUpdateCount(0);
  }, []);

  return { updateCount, reset };
};

export default useDynamicUpdateCount;
