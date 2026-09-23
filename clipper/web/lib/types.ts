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
  k?: string;   // clave estable (ms absolutos de la primera palabra)
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
  target_duration: { min: number; max: number };
  subtitles: {
    font: string;
    bold: boolean;
    size: number;
    color: string;
    shadow: boolean;
    outline: number;
    lines: number;
    max_chars_per_line: number;
    words_per_cue: number;          // 0 = por largo de línea; 1-3 = palabra por palabra
    position: "bottom" | "middle" | "follow";
    highlight: boolean;
    highlight_color: string;
    uppercase: boolean;
    box: boolean;
    box_color: string;
    box_opacity: number;
    animation: "none" | "pop";
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
    box: boolean;
    box_color: string;
    box_opacity: number;
    behind_subject: boolean;
  };
  camera: {
    zoom_on_speaker_change: boolean;
    zoom_amount: number;
    smoothing: number;
  };
  two_speakers: "switch" | "split";
  cuts: { remove_silences: boolean; min_pause_s: number; keep_pause_s: number };
  transitions: "none" | "punch" | "flash";
  music: { enabled: boolean; track: string; volume_db: number; duck: boolean; fade_out_s: number };
  progress_bar: { enabled: boolean; color: string; height: number };
  safe_area: { top: number; bottom: number; left: number; right: number };
}

export interface MusicTrack {
  name: string;
  path: string;
  size: number | null;
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
