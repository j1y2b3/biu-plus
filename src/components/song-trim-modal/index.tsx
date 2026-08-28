import { useEffect, useState } from "react";

import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, NumberInput, addToast } from "@heroui/react";
import { RiScissorsLine } from "@remixicon/react";

import { useSongTrim, type SongTrimTarget } from "@/store/song-trim";

/** 弹窗目标：在 SongTrimTarget 基础上带一个仅用于展示的标题 */
export interface SongTrimModalTarget extends SongTrimTarget {
  title?: string;
}

interface Props {
  target: SongTrimModalTarget | null;
  onClose: () => void;
}

const SongTrimModal = ({ target, onClose }: Props) => {
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);

  useEffect(() => {
    if (target) {
      const trim = useSongTrim.getState().getTrim(target);
      setStart(trim.start);
      setEnd(trim.end);
    }
  }, [target]);

  if (!target) return null;

  const handleSave = () => {
    useSongTrim.getState().setTrim(target, {
      start: start || 0,
      end: end || 0,
    });
    addToast({ title: "已保存裁剪设置", color: "success" });
    onClose();
  };

  const handleClear = () => {
    useSongTrim.getState().setTrim(target, { start: 0, end: 0 });
    addToast({ title: "已清除裁剪设置", color: "success" });
    onClose();
  };

  return (
    <Modal
      isOpen={Boolean(target)}
      onOpenChange={open => {
        if (!open) onClose();
      }}
      size="sm"
      disableAnimation
    >
      <ModalContent>
        <ModalHeader className="flex items-center gap-2 text-base">
          <RiScissorsLine size={18} className="text-primary" />
          单曲裁剪
        </ModalHeader>
        <ModalBody className="pb-4">
          <p className="text-foreground-500 w-full truncate text-sm">{target.title}</p>
          <div className="flex items-start gap-3">
            <NumberInput
              label="跳过开头（秒）"
              min={0}
              step={0.1}
              value={start}
              onValueChange={value => setStart(Math.max(0, value ?? 0))}
              placeholder="0"
            />
            <NumberInput
              label="跳过结尾（秒）"
              min={0}
              step={0.1}
              value={end}
              onValueChange={value => setEnd(Math.max(0, value ?? 0))}
              placeholder="0"
            />
          </div>
          <p className="text-foreground-400 text-xs">播放这首歌时自动跳过开头/结尾的秒数，保存后立即生效。</p>
        </ModalBody>
        <ModalFooter>
          <Button variant="light" onPress={onClose}>
            取消
          </Button>
          <Button variant="flat" color="danger" onPress={handleClear}>
            清除
          </Button>
          <Button color="primary" onPress={handleSave}>
            保存
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default SongTrimModal;
