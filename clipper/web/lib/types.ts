export type VideoStatus = "queued" | "downloading" | "transcribing" | "selecting" | "ready" | "error";
export type ClipStatus = "candidate" | "queued" | "rendering" | "ready" | "error";

export interface Video {
  id: string;
  created_at: string;
  updated_at: string;
  source_type: "youtube" | "drive" | "upload";
  source_url: string | null;
  source_file_id: string | null;
  source_path: string | null;
  source_name: string | null;
  title: string | null;
  duration_s: number | null;
  status: VideoStatus;
  status_detail: string | null;
  error: string | null;
  topics: string | null;
  min_duration_s: number;
  max_duration_s: number;
  preset_id: string;
  language: string | null;
  candidates_count: number;
}

export interface SubtitleCue {
  s: number;
  e: number;
  text: string;
  words?: { t: string; s: number; e: number }[];
}

export interface Clip {
  id: string;
  video_id: string;
  created_at: string;
  updated_at: string;
  position: number;
  start_s: number;
  end_s: number;
  orig_start_s: number;
  orig_end_s: number;
  title: string;
  hook: string;
  score: number;
  reason: string;
  status: ClipStatus;
  status_detail: string | null;
  error: string | null;
  preset_id: string | null;
  subtitles: SubtitleCue[] | null;
  subtitle_edits: Record<string, string>;
  preview_path: string | null;
  preview_offset_s: number | null;
  thumb_path: string | null;
  render_path: string | null;
  render_bytes: number | null;
  drive_file_id: string | null;
  drive_url: string | null;
  // URLs firmadas que agrega la API
  preview_url?: string | null;
  thumb_url?: string | null;
  render_url?: string | null;
}

export interface Preset {
  id: string;
  name: string;
  builtin: boolean;
  config: PresetConfig;
}

export interface PresetConfig {
  name: string;
  description?: string;
  subtitles: {
    font: string;
    bold: boolean;
    size: number;
    color: string;
    shadow: boolean;
    outline: number;
    lines: number;
    max_chars_per_line: number;
    position: "bottom";
    highlight: boolean;
    highlight_color: string;
    uppercase: boolean;
  };
  title: {
    show: boolean;
    permanent: boolean;
    duration_s: number;
    font: string;
    bold: boolean;
    size: number;
    color: string;
    lines: number;
  };
  camera: {
    zoom_on_speaker_change: boolean;
    zoom_amount: number;
    smoothing: number;
  };
  two_speakers: "switch" | "split";
  safe_area: { top: number; bottom: number; left: number; right: number };
  transitions: "none";
  progress_bar: boolean;
}

export const VIDEO_STATUS_LABEL: Record<VideoStatus, string> = {
  queued: "En cola",
  downloading: "Descargando",
  transcribing: "Transcribiendo",
  selecting: "Seleccionando momentos",
  ready: "Listo",
  error: "Error",
};

export const CLIP_STATUS_LABEL: Record<ClipStatus, string> = {
  candidate: "Candidato",
  queued: "En cola",
  rendering: "Renderizando",
  ready: "Renderizado",
  error: "Error",
};
