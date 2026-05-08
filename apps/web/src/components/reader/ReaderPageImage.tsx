import clsx from "clsx";
import { useEffect, useMemo, useState } from "react";

interface Props {
  src: string;
  alt: string;
  containerClassName?: string;
  imgClassName?: string;
  loading?: "lazy" | "eager";
  fetchPriority?: "high" | "low" | "auto";
  onLoad?: () => void;
  onError?: () => void;
}

/** Fired when a page image fails to load after a retry. The reader
 * listens to this event and refetches the comic metadata so a stale
 * pageCount in the DB can self-heal without forcing a full reload. */
export const PAGE_ERROR_EVENT = "reader:page-error";

/** Reserves a stable, page-shaped box so the layout doesn't collapse to
 * 0×0 while the image is loading or has errored. Without this, every
 * page transition snaps the parent grid (and any scroll position) as the
 * image's natural size pops in. */
const PLACEHOLDER_CLASSES = "min-h-[60vh] aspect-[2/3] max-h-[88vh] w-auto max-w-full";

export function ReaderPageImage({
  src,
  alt,
  containerClassName,
  imgClassName,
  loading = "lazy",
  fetchPriority = "auto",
  onLoad,
  onError,
}: Props) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setStatus("loading");
    setAttempt(0);
  }, [src]);

  const retrySrc = useMemo(
    () => (attempt > 0 ? `${src}${src.includes("?") ? "&" : "?"}retry=${attempt}` : src),
    [src, attempt],
  );

  const isPlaceholder = status !== "ready";

  return (
    <div
      className={clsx(
        "relative grid place-items-center",
        isPlaceholder && PLACEHOLDER_CLASSES,
        containerClassName,
      )}
    >
      {/* Skeleton background — only visible while we don't have a real
          image yet so the centered spinner / error sit on something
          stable instead of a 0×0 container. */}
      {isPlaceholder && (
        <div
          aria-hidden
          className="absolute inset-0 overflow-hidden rounded-md bg-white/[0.02] border border-white/5"
        >
          {status === "loading" && (
            <div
              className="absolute inset-y-0 -left-1/3 w-1/3 bg-gradient-to-r from-transparent via-white/[0.06] to-transparent"
              style={{ animation: "loading-indeterminate 1.4s ease-in-out infinite" }}
            />
          )}
        </div>
      )}

      {status !== "error" && (
        <img
          src={retrySrc}
          alt={alt}
          loading={loading}
          fetchPriority={fetchPriority}
          decoding="async"
          draggable={false}
          className={clsx(
            "h-full w-full object-contain transition-opacity duration-200",
            imgClassName,
            status === "loading" ? "opacity-0" : "opacity-100",
          )}
          onLoad={() => {
            setStatus("ready");
            onLoad?.();
          }}
          onError={() => {
            if (attempt < 1) {
              setAttempt((n) => n + 1);
              return;
            }
            setStatus("error");
            onError?.();
            // Notify the reader so it can refetch the comic metadata —
            // a 404 here usually means the stored pageCount drifted and
            // the user is past the real last page.
            if (typeof window !== "undefined") {
              window.dispatchEvent(new CustomEvent(PAGE_ERROR_EVENT, { detail: { src } }));
            }
          }}
        />
      )}

      {status === "loading" && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="flex items-center gap-2 rounded-full bg-ink-900/80 px-4 py-2 text-xs font-medium text-ink-200 shadow-lg backdrop-blur">
            <span
              aria-hidden
              className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-accent border-t-transparent"
            />
            Cargando página…
          </div>
        </div>
      )}

      {status === "error" && (
        <div className="absolute inset-0 grid place-items-center p-4 text-center">
          <div className="flex flex-col items-center gap-3 max-w-xs">
            <div className="grid h-12 w-12 place-items-center rounded-2xl border border-red-400/30 bg-red-500/10 text-red-200 text-xl font-black">
              !
            </div>
            <div className="rounded-xl border border-red-400/20 bg-red-500/10 px-4 py-2 text-xs font-semibold text-red-100">
              Página no disponible
            </div>
            <button
              type="button"
              onClick={() => {
                setStatus("loading");
                setAttempt((n) => n + 1);
              }}
              className="rounded-md border border-white/15 bg-white/5 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-slate-200 hover:bg-white/10"
            >
              Reintentar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
