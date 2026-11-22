import { HoverPopover } from "./hover-popover.ts";

export class SingletonHoverPopover extends HoverPopover {
  retarget(target: HTMLElement): void {
    this.targetEl?.removeEventListener("mouseover", this.onMouseIn);
    this.targetEl?.removeEventListener("mouseout", this.onMouseOut);
    this.targetEl = target;
    target.addEventListener("mouseover", this.onMouseIn);
    target.addEventListener("mouseout", this.onMouseOut);
    this.onTarget = true;
    this.transition();
  }
}
