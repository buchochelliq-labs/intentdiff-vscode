// The perceptual asset-diff viewer markup (all artifacts come from the Rust engine).

import { escapeHtml, isRecord } from "./reviewWebviewHtml";
import type { RenderOptions, ReviewAssetDiff, ReviewAssetHotspot } from "./reviewWebviewModel";

export function isImageLikePath(path: string): boolean {
  return /\.(png|jpe?g|webp)$/iu.test(path);
}

export function assetDiffFromMetadata(metadata: Record<string, unknown> | undefined): ReviewAssetDiff | undefined {
  if (!metadata || !isRecord(metadata.asset_diff)) {
    return undefined;
  }
  const raw = metadata.asset_diff;
  const artifacts = isRecord(raw.artifacts)
    ? Object.fromEntries(Object.entries(raw.artifacts).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
    : undefined;
  const hotspots = Array.isArray(raw.hotspots)
    ? raw.hotspots.filter(isRecord).map((item) => item as unknown as ReviewAssetHotspot)
    : undefined;
  const histograms = isRecord(raw.histograms) ? raw.histograms as unknown as ReviewAssetDiff["histograms"] : undefined;
  const hotspotNavigation = isRecord(raw.hotspot_navigation)
    ? raw.hotspot_navigation as unknown as ReviewAssetDiff["hotspot_navigation"]
    : undefined;
  const comparisonDimensions = isRecord(raw.comparison_dimensions)
    ? raw.comparison_dimensions as unknown as ReviewAssetDiff["comparison_dimensions"]
    : undefined;
  return {
    status: typeof raw.status === "string" ? raw.status : undefined,
    summary: typeof raw.summary === "string" ? raw.summary : undefined,
    changed_pixel_percentage: typeof raw.changed_pixel_percentage === "number" ? raw.changed_pixel_percentage : null,
    mean_absolute_error: typeof raw.mean_absolute_error === "number" ? raw.mean_absolute_error : null,
    root_mean_squared_error: typeof raw.root_mean_squared_error === "number" ? raw.root_mean_squared_error : null,
    comparison_dimensions: comparisonDimensions,
    artifacts,
    hotspots,
    hotspot_navigation: hotspotNavigation,
    histograms,
  };
}

export function assetArtifact(label: string, path: string | undefined, options: RenderOptions): string {
  if (!path) {
    return `<div class="asset-artifact missing"><strong>${escapeHtml(label)}</strong><span>Not generated</span></div>`;
  }
  const src = options.resolveResourceUri?.(path) ?? path;
  return `<figure class="asset-artifact">
    <img src="${escapeHtml(src)}" alt="${escapeHtml(label)} artifact">
    <figcaption><strong>${escapeHtml(label)}</strong><span>${escapeHtml(path)}</span></figcaption>
  </figure>`;
}

/** Stable selection key shared by the hotspot list item, its on-image marker, and its lasso. */
export function assetHotspotKey(hotspot: ReviewAssetHotspot, index: number): string {
  return hotspot.id ?? `hotspot-${index + 1}`;
}

export function assetHotspot(hotspot: ReviewAssetHotspot, index: number): string {
  const bbox = hotspot.bbox;
  const location = bbox
    ? `${bbox.x ?? 0},${bbox.y ?? 0} ${bbox.width ?? 0}x${bbox.height ?? 0}`
    : "unknown bounds";
  const key = assetHotspotKey(hotspot, index);
  return `<li class="asset-hotspot severity-${escapeHtml(hotspot.severity ?? "low")}" data-asset-hotspot="${escapeHtml(key)}" role="button" tabindex="0" aria-pressed="false">
    <strong><span class="asset-hotspot-badge">${index + 1}</span>${escapeHtml(hotspot.label ?? hotspot.id ?? "Hotspot")}</strong>
    <span>${escapeHtml(formatPercent(hotspot.changed_pixel_percentage))} · ${escapeHtml(location)} · ${escapeHtml(String(hotspot.pixel_count ?? 0))} pixels</span>
    <p>${escapeHtml(hotspot.summary ?? "Changed region detected by Rust.")}</p>
  </li>`;
}

export function resolveAsset(path: string | undefined, options: RenderOptions): string | undefined {
  if (!path) {
    return undefined;
  }
  return options.resolveResourceUri?.(path) ?? path;
}

/** Clamp a normalized (0..1) coordinate, or undefined when it isn't a finite number. */
export function clamp01(value: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.min(1, Math.max(0, value));
}

/** A numbered marker positioned over an image from the engine's normalized centroid. */
export function assetMarker(hotspot: ReviewAssetHotspot, index: number): string {
  const cx = clamp01(hotspot.centroid?.x);
  const cy = clamp01(hotspot.centroid?.y);
  if (cx === undefined || cy === undefined) {
    return "";
  }
  const number = index + 1;
  const key = assetHotspotKey(hotspot, index);
  const title = `${hotspot.label ?? `Hotspot ${number}`} — ${formatPercent(hotspot.changed_pixel_percentage)} changed`;
  return `<button type="button" class="asset-marker severity-${escapeHtml(hotspot.severity ?? "low")}" data-asset-hotspot="${escapeHtml(key)}" style="left:${(cx * 100).toFixed(2)}%;top:${(cy * 100).toFixed(2)}%" title="${escapeHtml(title)}">${number}</button>`;
}

/**
 * Photoshop-style marching-ants lasso around each changed region, drawn in the
 * comparison-dimensions pixel space so it aligns 1:1 over the before, after, and
 * difference images (which all share those dimensions). Returns "" when the engine
 * gave no comparison dimensions or bounding boxes — the numbered markers still show.
 */
export function assetLasso(
  hotspots: ReviewAssetHotspot[],
  comparisonDimensions: ReviewAssetDiff["comparison_dimensions"],
): string {
  const width = comparisonDimensions?.width;
  const height = comparisonDimensions?.height;
  if (!width || !height || width <= 0 || height <= 0) {
    return "";
  }
  const pad = Math.max(2, Math.round(Math.min(width, height) * 0.006));
  const rects = hotspots
    .map((hotspot, index) => {
      const bbox = hotspot.bbox;
      if (!bbox) {
        return "";
      }
      const rx = Math.max(0, (bbox.x ?? 0) - pad);
      const ry = Math.max(0, (bbox.y ?? 0) - pad);
      const rw = Math.min(width - rx, Math.max(bbox.width ?? 0, 1) + pad * 2);
      const rh = Math.min(height - ry, Math.max(bbox.height ?? 0, 1) + pad * 2);
      const key = assetHotspotKey(hotspot, index);
      const attrs = `x="${rx.toFixed(1)}" y="${ry.toFixed(1)}" width="${rw.toFixed(1)}" height="${rh.toFixed(1)}" rx="${pad}"`;
      return `<g class="asset-lasso severity-${escapeHtml(hotspot.severity ?? "low")}" data-asset-hotspot="${escapeHtml(key)}">`
        + `<rect class="asset-lasso-hit" ${attrs}></rect>`
        + `<rect class="asset-lasso-shadow" ${attrs}></rect>`
        + `<rect class="asset-lasso-ants" ${attrs}></rect>`
        + `</g>`;
    })
    .join("");
  if (!rects) {
    return "";
  }
  return `<svg class="asset-lasso-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">${rects}</svg>`;
}

/** Change overlay = lasso outlines + numbered centroid markers, aligned inset:0 over an image box. */
export function assetChangeOverlay(
  hotspots: ReviewAssetHotspot[],
  comparisonDimensions: ReviewAssetDiff["comparison_dimensions"],
): string {
  if (hotspots.length === 0) {
    return "";
  }
  const lasso = assetLasso(hotspots, comparisonDimensions);
  const markers = hotspots.map((hotspot, index) => assetMarker(hotspot, index)).join("");
  return `<div class="asset-overlay" data-asset-overlay>${lasso}<div class="asset-markers">${markers}</div></div>`;
}

/**
 * Interactive image comparison viewer. Four modes — side-by-side, onion-skin
 * (opacity blend + blink comparator), swipe (curtain reveal), and difference —
 * each overlaid with a marching-ants lasso + numbered markers around every changed
 * region. All mode switching / blending / swiping / blinking is client-side DOM;
 * no image processing happens in the webview. Side-by-side / onion / swipe need the
 * `before` + `after` layer artifacts and degrade to the `contact_sheet` or
 * difference image when absent.
 */
export function assetModeViewer(
  artifacts: Record<string, string>,
  hotspots: ReviewAssetHotspot[],
  comparisonDimensions: ReviewAssetDiff["comparison_dimensions"],
  options: RenderOptions,
): string {
  const before = resolveAsset(artifacts.before, options);
  const after = resolveAsset(artifacts.after ?? artifacts.changed, options);
  const differenceSrc = resolveAsset(artifacts.heatmap ?? artifacts.diff ?? artifacts.overlay, options);
  const contactSheet = resolveAsset(artifacts.contact_sheet, options);
  const hasLayers = before !== undefined && after !== undefined;
  const overlay = assetChangeOverlay(hotspots, comparisonDimensions);
  const defaultMode = differenceSrc ? "difference" : hasLayers ? "side-by-side" : "difference";

  const modeButton = (mode: string, label: string, enabled: boolean): string =>
    `<button type="button" role="tab" class="asset-mode-btn${mode === defaultMode ? " is-active" : ""}"`
    + ` data-asset-mode="${mode}" aria-selected="${mode === defaultMode ? "true" : "false"}"${enabled ? "" : " disabled"}>${label}</button>`;

  const view = (mode: string, inner: string): string =>
    `<div class="asset-view${mode === defaultMode ? " is-active" : ""}" data-asset-view="${mode}">${inner}</div>`;

  const stagebox = (inner: string, extraClass = ""): string =>
    `<div class="asset-stagebox${extraClass ? ` ${extraClass}` : ""}">${inner}${overlay}</div>`;

  const sideBySide = hasLayers
    ? `<div class="asset-sbs">
        <figure>${stagebox(`<img src="${escapeHtml(before ?? "")}" alt="Before image">`)}<figcaption>◆ Before</figcaption></figure>
        <figure>${stagebox(`<img src="${escapeHtml(after ?? "")}" alt="After image">`)}<figcaption>◆ After</figcaption></figure>
      </div>`
    : contactSheet
      ? `<div class="asset-sbs single"><figure><img src="${escapeHtml(contactSheet)}" alt="Before beside after"><figcaption>Before · After</figcaption></figure></div>`
      : `<p class="asset-empty">No before/after images were generated.</p>`;

  const onion = hasLayers
    ? stagebox(
        `<img class="asset-onion-base" src="${escapeHtml(before ?? "")}" alt="Before image (base layer)">`
        + `<img class="asset-onion-top" src="${escapeHtml(after ?? "")}" alt="After image (blended layer)" data-asset-onion-top style="opacity:0.5">`,
        "asset-onion",
      )
    : `<p class="asset-empty">Onion-skin needs separate before/after images.</p>`;

  const swipe = hasLayers
    ? stagebox(
        `<img class="asset-swipe-base" src="${escapeHtml(before ?? "")}" alt="Before image">`
        + `<img class="asset-swipe-top" src="${escapeHtml(after ?? "")}" alt="After image" data-asset-swipe-top>`
        + `<div class="asset-swipe-divider" data-asset-swipe-handle role="slider" aria-label="Reveal after image" aria-valuemin="0" aria-valuemax="100" aria-valuenow="50" tabindex="0"><span class="asset-swipe-grip"></span></div>`,
        "asset-swipe",
      )
    : `<p class="asset-empty">Swipe needs separate before/after images.</p>`;

  const difference = differenceSrc
    ? stagebox(`<img src="${escapeHtml(differenceSrc)}" alt="Perceptual difference image">`, "asset-diff-stage")
    : `<p class="asset-empty">No difference image was generated.</p>`;

  return `<div class="asset-viewer" data-asset-viewer data-asset-mode="${defaultMode}" data-asset-outline="on">
    <div class="asset-mode-switch" role="tablist" aria-label="Image comparison mode">
      ${modeButton("side-by-side", "Side by side", hasLayers || contactSheet !== undefined)}
      ${modeButton("onion", "Onion", hasLayers)}
      ${modeButton("swipe", "Swipe", hasLayers)}
      ${modeButton("difference", "Difference", differenceSrc !== undefined)}
      <div class="asset-mode-controls">
        <label class="asset-onion-ctl asset-opacity" title="Blend before ↔ after">
          <span>Blend</span>
          <input type="range" min="0" max="100" value="50" step="1" data-asset-opacity aria-label="Onion-skin opacity">
        </label>
        <div class="asset-onion-ctl asset-blink" role="group" aria-label="Blink comparator">
          <button type="button" class="asset-blink-toggle" data-asset-blink aria-pressed="false" title="Auto-flip before ↔ after">▶ Blink</button>
          <label class="asset-blink-speed" title="Blink speed"><span>Speed</span>
            <input type="range" min="1" max="10" value="4" step="1" data-asset-blink-speed aria-label="Blink speed">
          </label>
        </div>
        ${overlay ? `<label class="asset-outline-toggle" title="Show / hide change outlines">
          <input type="checkbox" data-asset-outline-toggle checked><span>Outline changes</span>
        </label>` : ""}
      </div>
    </div>
    <div class="asset-stage">
      ${view("side-by-side", sideBySide)}
      ${view("onion", onion)}
      ${view("swipe", swipe)}
      ${view("difference", difference)}
    </div>
  </div>`;
}

/**
 * Per-channel delta histograms as small inline SVG bar charts (R/G/B/luma, +alpha
 * when tracked). Each bar is a delta bin (0 = unchanged … high = large change);
 * heights use log scaling so the dominant "no change" bin doesn't flatten the rest.
 */
export function assetHistogramBars(histograms: NonNullable<ReviewAssetDiff["histograms"]>): string {
  const channels: Array<{ key: string; label: string; values: number[] | undefined }> = [
    { key: "red", label: "Red", values: histograms.red_delta },
    { key: "green", label: "Green", values: histograms.green_delta },
    { key: "blue", label: "Blue", values: histograms.blue_delta },
    { key: "brightness", label: "Luma", values: histograms.brightness_delta },
    { key: "alpha", label: "Alpha", values: Array.isArray(histograms.alpha_delta) ? histograms.alpha_delta : undefined },
  ];
  const rows = channels
    .filter((channel): channel is { key: string; label: string; values: number[] } =>
      Array.isArray(channel.values) && channel.values.length > 0)
    .map((channel) => assetHistogramRow(channel.key, channel.label, channel.values))
    .join("");
  return `<div class="asset-histogram-bars">${rows}</div>`;
}

export function assetHistogramRow(key: string, label: string, values: number[]): string {
  const bins = values.length;
  const max = Math.max(1, ...values);
  const barWidth = 6;
  const gap = 2;
  const chartHeight = 40;
  const chartWidth = bins * (barWidth + gap);
  const bars = values
    .map((value, index) => {
      const norm = value <= 0 ? 0 : Math.log1p(value) / Math.log1p(max);
      const barHeight = value > 0 ? Math.max(1, Math.round(norm * chartHeight)) : 0;
      const x = index * (barWidth + gap);
      const y = chartHeight - barHeight;
      return `<rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}"><title>bin ${index}: ${value}</title></rect>`;
    })
    .join("");
  return `<div class="asset-histogram-row channel-${escapeHtml(key)}">
    <span class="asset-histogram-label">${escapeHtml(label)}</span>
    <svg class="asset-histogram-chart" viewBox="0 0 ${chartWidth} ${chartHeight}" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(label)} delta histogram, peak ${escapeHtml(peakBin(values))}">${bars}</svg>
    <span class="asset-histogram-peak">${escapeHtml(peakBin(values))}</span>
  </div>`;
}

export function peakBin(values: number[] | undefined): string {
  if (!Array.isArray(values) || values.length === 0) {
    return "n/a";
  }
  let bestIndex = 0;
  for (let index = 1; index < values.length; index += 1) {
    if (values[index] > values[bestIndex]) {
      bestIndex = index;
    }
  }
  return `bin ${bestIndex}`;
}

export function formatPercent(value: number | null | undefined): string {
  return typeof value === "number" ? `${value.toFixed(value < 10 ? 1 : 0)}%` : "n/a";
}

export function formatMetric(value: number | null | undefined): string {
  return typeof value === "number" ? value.toFixed(value < 10 ? 3 : 1) : "n/a";
}

