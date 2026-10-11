import type { StageView } from "./attention";
import { cn } from "./lib/utils";

/** The workflow and stage, with one progress mark per stage when it has more than one. */
export function StageLine({ stage }: { stage: StageView }) {
  return (
    <div className="mt-0.5 flex h-4 items-center gap-1.5 text-2xs text-muted-foreground">
      <span className="truncate">
        {stage.workflowLabel} › {stage.stageLabel}
      </span>
      {stage.showMarks ? (
        <span className="flex shrink-0 items-center gap-0.5" aria-hidden="true">
          {Array.from({ length: stage.total }, (_, index) => {
            const position = index + 1;
            const kind =
              position < stage.position
                ? "done"
                : position === stage.position
                  ? "current"
                  : "todo";
            return (
              <span
                key={index}
                className={cn(
                  "h-1 rounded-full",
                  kind === "current" ? "w-3" : "w-1.5",
                  kind === "done" && "bb-sidebar-stage-mark-done",
                  kind === "current" && "bb-sidebar-stage-mark-current",
                  kind === "todo" && "bb-sidebar-stage-mark-todo",
                )}
              />
            );
          })}
        </span>
      ) : null}
    </div>
  );
}
