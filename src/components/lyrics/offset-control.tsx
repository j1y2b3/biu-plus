import { useCallback, useEffect, useRef, useState } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "@heroui/react";
import { RiArrowDownSLine, RiArrowUpSLine, RiResetLeftLine, RiTimeLine } from "@remixicon/react";

import IconButton from "../icon-button";

interface OffsetControlProps {
  value: number;
  step?: number;
  onChange: (next: number) => void;
  onOpenChange?: (open: boolean) => void;
}

const DEFAULT_STEP = 100;
const LONG_PRESS_DELAY = 250; // 按住多久后开始连续调整（ms）
const REPEAT_INTERVAL = 100; // 长按连发的间隔（ms）

const formatLabel = (ms: number) => (ms >= 0 ? `+${ms}` : `${ms}`);

const OffsetControl = ({ value, step = DEFAULT_STEP, onChange, onOpenChange }: OffsetControlProps) => {
  const [open, setOpen] = useState(false);
  const valueRef = useRef(value);
  const repeatTimerRef = useRef<number | null>(null);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  const stopRepeat = useCallback(() => {
    if (repeatTimerRef.current !== null) {
      window.clearTimeout(repeatTimerRef.current);
      window.clearInterval(repeatTimerRef.current);
      repeatTimerRef.current = null;
    }
  }, []);

  useEffect(() => stopRepeat, [stopRepeat]);

  const adjust = useCallback(
    (delta: number) => {
      const next = valueRef.current + delta;
      valueRef.current = next;
      onChange(next);
    },
    [onChange],
  );

  const startRepeat = useCallback(
    (delta: number) => {
      stopRepeat();
      // 先等一小段时间，按住超过 LONG_PRESS_DELAY 才开始连续调整，避免误触
      repeatTimerRef.current = window.setTimeout(() => {
        repeatTimerRef.current = window.setInterval(() => adjust(delta), REPEAT_INTERVAL);
      }, LONG_PRESS_DELAY);
    },
    [adjust, stopRepeat],
  );

  const handlePointerDown = useCallback(
    (delta: number) => (event: React.PointerEvent<HTMLElement>) => {
      event.preventDefault();
      adjust(delta);
      startRepeat(delta);
    },
    [adjust, startRepeat],
  );

  const handlePointerEnd = useCallback(() => {
    stopRepeat();
  }, [stopRepeat]);

  const handleKeyDown = useCallback(
    (delta: number) => (event: React.KeyboardEvent<HTMLElement>) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        adjust(delta);
      }
    },
    [adjust],
  );

  const handleReset = useCallback(() => {
    valueRef.current = 0;
    onChange(0);
  }, [onChange]);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );

  return (
    <Popover
      placement="right"
      showArrow={false}
      shouldCloseOnBlur={false}
      shouldCloseOnInteractOutside={false}
      disableAnimation
      offset={8}
      isOpen={open}
      onOpenChange={handleOpenChange}
    >
      <PopoverTrigger>
        <IconButton
          size="sm"
          variant="light"
          aria-label="调整歌词偏移"
          className="bg-foreground/20 text-foreground hover:bg-foreground/30 min-w-0 rounded-full text-xs font-semibold"
        >
          <RiTimeLine size={16} />
        </IconButton>
      </PopoverTrigger>
      <PopoverContent className="px-3 py-2">
        <div className="flex flex-col items-center gap-1">
          <IconButton
            size="sm"
            variant="light"
            aria-label="歌词提前（减小偏移）"
            className="text-foreground hover:bg-foreground/20 rounded-full"
            onPointerDown={handlePointerDown(-step)}
            onPointerUp={handlePointerEnd}
            onPointerLeave={handlePointerEnd}
            onPointerCancel={handlePointerEnd}
            onKeyDown={handleKeyDown(-step)}
          >
            <RiArrowUpSLine size={20} />
          </IconButton>
          <span className="text-foreground/80 text-xs font-bold whitespace-nowrap">{formatLabel(value)} ms</span>
          <IconButton
            size="sm"
            variant="light"
            aria-label="歌词延后（增大偏移）"
            className="text-foreground hover:bg-foreground/20 rounded-full"
            onPointerDown={handlePointerDown(step)}
            onPointerUp={handlePointerEnd}
            onPointerLeave={handlePointerEnd}
            onPointerCancel={handlePointerEnd}
            onKeyDown={handleKeyDown(step)}
          >
            <RiArrowDownSLine size={20} />
          </IconButton>
          <button
            type="button"
            aria-label="重置歌词偏移"
            onClick={handleReset}
            className="text-foreground/50 hover:text-foreground mt-1 rounded-full p-1 transition-colors"
          >
            <RiResetLeftLine size={14} />
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default OffsetControl;
