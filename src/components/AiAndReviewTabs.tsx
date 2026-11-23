import { useState } from 'react';
import {
  CheckCircle2,
  Download,
  Languages,
  MessageSquare,
  Mic,
  Scissors,
  Send,
  Sparkles,
  Trash2,
  Wand2,
} from 'lucide-react';
import {
  CaptionSegment,
  ClipLabelColor,
  MediaAsset,
  ProjectVersion,
  ReviewComment,
  SequenceSettings,
  TimelineClip,
} from '../types/editor';
import { buildSrtContent } from '../utils/interchange';
import { parseJsonResponse, STATIC_BACKEND_NOTICE } from '../utils/runtime';
import { detectSceneCuts } from '../utils/sceneDetect';
import { formatTimecode } from '../utils/timecode';

export interface AiActionPayload {
  type: string;
  clipId?: string;
  presetId?: string;
  label?: ClipLabelColor;
  name?: string;
  text?: string;
  subtitle?: string;
  layout?: string;
  edge?: 'in' | 'out';
  transitionType?: string;
  aspect?: string;
  time?: number;
}

interface AiTabProps {
  playhead: number;
  sequence: SequenceSettings;
  clips: TimelineClip[];
  assets: MediaAsset[];
  selectedClip: TimelineClip | null;
  captions: CaptionSegment[];
  onUpdateCaptions: (captions: CaptionSegment[]) => void;
  onExecuteAiActions: (actions: AiActionPayload[]) => void;
  onAddGeneratedVoiceover: (name: string, base64Wav: string) => void;
  onSplitClipMultiple: (clipId: string, splitTimes: number[]) => void;
  onRemixMusicToSequence: () => void;
  onSeek: (time: number) => void;
}

export function AiAndTextTab({
  playhead,
  sequence,
  clips,
  assets,
  selectedClip,
  captions,
  onUpdateCaptions,
  onExecuteAiActions,
  onAddGeneratedVoiceover,
  onSplitClipMultiple,
  onRemixMusicToSequence,
  onSeek,
}: AiTabProps) {
  const [subMode, setSubMode] = useState<'assistant' | 'transcript' | 'voiceover'>('assistant');

  // AI Assistant State
  const [prompt, setPrompt] = useState('');
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'assistant'; text: string }>>([
    {
      role: 'assistant',
      text: 'Ready to edit. Ask me to split at playhead, apply a color look, add titles, auto-reframe to 9:16, or duck music.',
    },
  ]);
  const [assistantBusy, setAssistantBusy] = useState(false);

  // Transcript / Captions State
  const [transcriptBusy, setTranscriptBusy] = useState(false);
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
  const [transcriptSearch, setTranscriptSearch] = useState('');
  const [targetLang, setTargetLang] = useState('Spanish');
  const [translateBusy, setTranslateBusy] = useState(false);

  // Voiceover TTS State
  const [voScript, setVoScript] = useState(
    'Every frame holds a quiet tension between shadow and daylight.'
  );
  const [voVoice, setVoVoice] = useState('Kore');
  const [voBusy, setVoBusy] = useState(false);
  const [voError, setVoError] = useState<string | null>(null);

  // Scene Detection State
  const [sceneBusy, setSceneBusy] = useState(false);
  const [sceneMessage, setSceneMessage] = useState<string | null>(null);

  const handleSendAssistant = async () => {
    const trimmed = prompt.trim();
    if (!trimmed || assistantBusy) return;

    setMessages((m) => [...m, { role: 'user', text: trimmed }]);
    setPrompt('');
    setAssistantBusy(true);

    try {
      const res = await fetch('/api/ai/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: trimmed,
          playhead,
          sequence: { name: sequence.name, width: sequence.width, height: sequence.height, fps: sequence.fps },
          assetsSummary: assets.map((a) => ({ id: a.id, name: a.name, type: a.type, duration: a.duration })),
          clipsSummary: clips.map((c) => ({
            id: c.id,
            name: c.name,
            trackId: c.trackId,
            type: c.type,
            start: c.start,
            duration: c.duration,
          })),
        }),
      });
      const data = await parseJsonResponse<{
        actions?: AiActionPayload[];
        reply?: string;
        error?: string;
      }>(res);
      if (!data) {
        throw new Error(STATIC_BACKEND_NOTICE);
      }
      if (!res.ok) {
        throw new Error(data.error || 'AI Assistant request failed');
      }
      if (Array.isArray(data.actions) && data.actions.length > 0) {
        onExecuteAiActions(data.actions);
      }
      setMessages((m) => [...m, { role: 'assistant', text: data.reply || 'Sequence updated.' }]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to reach AI Assistant.';
      setMessages((m) => [...m, { role: 'assistant', text: msg }]);
    } finally {
      setAssistantBusy(false);
    }
  };

  const handleTranscribeSelected = async () => {
    const audioClip =
      (selectedClip && (selectedClip.type === 'audio' || selectedClip.type === 'video') ? selectedClip : null) ||
      clips.find((c) => c.type === 'audio' || c.type === 'video');
    if (!audioClip) {
      setTranscriptError('Add or select an audio or video clip first.');
      return;
    }
    const asset = assets.find((a) => a.id === audioClip.assetId);
    if (!asset?.src) {
      setTranscriptError('Selected clip has no audio source.');
      return;
    }

    setTranscriptBusy(true);
    setTranscriptError(null);

    try {
      const resp = await fetch(asset.src);
      const blob = await resp.blob();
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = String(reader.result || '');
          resolve(result.split(',')[1] || '');
        };
        reader.onerror = () => reject(new Error('Failed to read audio blob'));
        reader.readAsDataURL(blob);
      });

      const apiRes = await fetch('/api/ai/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audioBase64: base64,
          mimeType: blob.type || 'audio/wav',
          duration: audioClip.duration,
        }),
      });
      const data = await parseJsonResponse<{
        segments?: Array<{ speaker?: string; start?: number; end?: number; text?: string; hasFiller?: boolean }>;
        rawText?: string;
        error?: string;
      }>(apiRes);
      if (!data) throw new Error(STATIC_BACKEND_NOTICE);
      if (!apiRes.ok) throw new Error(data.error || 'Transcription failed');

      const mapped: CaptionSegment[] = (data.segments || []).map(
        (seg: { speaker?: string; start?: number; end?: number; text?: string; hasFiller?: boolean }, idx: number) => ({
          id: `cap_${Date.now()}_${idx}`,
          speaker: seg.speaker || 'Speaker 1',
          start: audioClip.start + (seg.start ?? idx * 3),
          end: audioClip.start + (seg.end ?? (idx + 1) * 3),
          text: seg.text || '',
          hasFiller: Boolean(seg.hasFiller),
        })
      );
      if (mapped.length > 0) {
        onUpdateCaptions(mapped);
      } else if (data.rawText) {
        onUpdateCaptions([
          {
            id: `cap_${Date.now()}`,
            speaker: 'Speaker 1',
            start: audioClip.start,
            end: audioClip.start + audioClip.duration,
            text: data.rawText,
          },
        ]);
      }
    } catch (err) {
      setTranscriptError(err instanceof Error ? err.message : 'Transcription error');
    } finally {
      setTranscriptBusy(false);
    }
  };

  const handleTranslateCaptions = async () => {
    if (captions.length === 0 || translateBusy) return;
    setTranslateBusy(true);
    setTranscriptError(null);
    try {
      const res = await fetch('/api/ai/translate-captions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          segments: captions.map((c) => ({ id: c.id, text: c.text })),
          targetLanguage: targetLang,
        }),
      });
      const data = await parseJsonResponse<{
        translated?: Array<{ id: string; text: string }>;
        error?: string;
      }>(res);
      if (!data) throw new Error(STATIC_BACKEND_NOTICE);
      if (!res.ok) throw new Error(data.error || 'Translation failed');
      const map = new Map<string, string>(
        (data.translated || []).map((t: { id: string; text: string }) => [t.id, t.text])
      );
      onUpdateCaptions(
        captions.map((c) => ({
          ...c,
          text: map.get(c.id) || c.text,
        }))
      );
    } catch (err) {
      setTranscriptError(err instanceof Error ? err.message : 'Translation failed');
    } finally {
      setTranslateBusy(false);
    }
  };

  const handleRemoveFillersAndPauses = () => {
    const cleaned = captions
      .filter((c) => !c.hasFiller && c.text.trim().length > 0)
      .map((c) => ({
        ...c,
        text: c.text.replace(/\b(um+|uh+|like,|you know,)\b/gi, '').replace(/\s{2,}/g, ' ').trim(),
      }));
    onUpdateCaptions(cleaned);
  };

  const handleGenerateVoiceover = async () => {
    if (!voScript.trim() || voBusy) return;
    setVoBusy(true);
    setVoError(null);
    try {
      const res = await fetch('/api/ai/voiceover-tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ script: voScript, voiceName: voVoice }),
      });
      const data = await parseJsonResponse<{
        audioBase64?: string;
        error?: string;
      }>(res);
      if (!data) throw new Error(STATIC_BACKEND_NOTICE);
      if (!res.ok || !data.audioBase64) throw new Error(data.error || 'Voiceover generation failed');
      onAddGeneratedVoiceover(`VO_${voVoice}_${Date.now().toString().slice(-4)}.wav`, data.audioBase64);
    } catch (err) {
      setVoError(err instanceof Error ? err.message : 'Voiceover error');
    } finally {
      setVoBusy(false);
    }
  };

  const handleRunSceneDetect = async () => {
    if (!selectedClip) return;
    const asset = assets.find((a) => a.id === selectedClip.assetId);
    if (!asset) return;
    setSceneBusy(true);
    setSceneMessage('Scanning frames...');
    try {
      const cuts = await detectSceneCuts(selectedClip, asset);
      if (cuts.length > 0) {
        onSplitClipMultiple(selectedClip.id, cuts);
        setSceneMessage(`Detected and split ${cuts.length} scene cut(s).`);
      } else {
        setSceneMessage('No hard cuts detected inside selected clip.');
      }
    } catch {
      setSceneMessage('Scene detection failed on this clip.');
    } finally {
      setSceneBusy(false);
    }
  };

  const visibleCaptions = captions.filter(
    (c) => !transcriptSearch.trim() || c.text.toLowerCase().includes(transcriptSearch.toLowerCase())
  );

  return (
    <div className="space-y-3">
      {/* Sub-mode switcher */}
      <div className="grid grid-cols-3 gap-1 p-1 bg-[#121215] border border-[#27272E] rounded">
        {(
          [
            { id: 'assistant', label: 'Assistant' },
            { id: 'transcript', label: 'Captions' },
            { id: 'voiceover', label: 'Voice & AI' },
          ] as const
        ).map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setSubMode(m.id)}
            className={`py-1 text-[11px] font-medium rounded cursor-pointer ${
              subMode === m.id ? 'bg-[#25252D] text-white' : 'text-[#8E8E9B] hover:text-white'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {subMode === 'assistant' && (
        <div className="space-y-2.5">
          <div className="h-56 overflow-y-auto space-y-2 p-2 rounded bg-[#111115] border border-[#25252C]">
            {messages.map((m, i) => (
              <div
                key={i}
                className={`p-2 rounded text-[11px] leading-relaxed ${
                  m.role === 'user'
                    ? 'bg-[#2563EB]/20 border border-[#3B82F6]/30 text-[#E0F2FE] ml-4'
                    : 'bg-[#191920] border border-[#27272E] text-[#D4D4DC] mr-2'
                }`}
              >
                {m.text}
              </div>
            ))}
          </div>

          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSendAssistant();
              }}
              placeholder="e.g. Apply Teal & Amber look..."
              className="flex-1 bg-[#111115] border border-[#2B2B34] focus:border-[#3B82F6] rounded px-2.5 py-1.5 text-xs text-white outline-none"
            />
            <button
              type="button"
              disabled={assistantBusy || !prompt.trim()}
              onClick={handleSendAssistant}
              className="p-2 rounded bg-[#2563EB] hover:bg-[#3B82F6] text-white disabled:opacity-40 cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex flex-wrap gap-1 pt-1">
            {['Add lower third title', 'Apply Noir look', 'Reframe 9:16', 'Duck music'].map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => setPrompt(q)}
                className="px-2 py-1 text-[10px] bg-[#141418] hover:bg-[#22222A] border border-[#27272E] rounded text-[#A1A1AF] cursor-pointer"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      {subMode === 'transcript' && (
        <div className="space-y-2.5">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={transcriptBusy}
              onClick={handleTranscribeSelected}
              className="flex-1 py-1.5 px-2 text-[11px] font-medium bg-[#2563EB] hover:bg-[#3B82F6] text-white rounded disabled:opacity-50 cursor-pointer"
            >
              {transcriptBusy ? 'Transcribing...' : 'Transcribe Audio'}
            </button>
            <button
              type="button"
              onClick={handleRemoveFillersAndPauses}
              title="Remove Filler Words & Blank Captions"
              className="py-1.5 px-2 text-[11px] bg-[#1F1F26] hover:bg-[#2A2A34] border border-[#2F2F39] text-[#D4D4DC] rounded cursor-pointer"
            >
              Clean Fillers
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            <select
              value={targetLang}
              onChange={(e) => setTargetLang(e.target.value)}
              className="flex-1 bg-[#121215] border border-[#2B2B34] rounded px-2 py-1 text-[11px] text-[#E4E4EC] outline-none"
            >
              <option value="Spanish">Spanish</option>
              <option value="French">French</option>
              <option value="Japanese">Japanese</option>
              <option value="German">German</option>
              <option value="Portuguese">Portuguese</option>
            </select>
            <button
              type="button"
              disabled={translateBusy || captions.length === 0}
              onClick={handleTranslateCaptions}
              className="flex items-center gap-1 px-2 py-1 text-[11px] bg-[#1F1F26] hover:bg-[#2A2A34] border border-[#2F2F39] text-[#D4D4DC] rounded disabled:opacity-40 cursor-pointer"
            >
              <Languages className="w-3 h-3" />
              {translateBusy ? '...' : 'Translate'}
            </button>
            <button
              type="button"
              onClick={() => {
                const srt = buildSrtContent(captions);
                const blob = new Blob([srt], { type: 'text/plain;charset=utf-8' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${sequence.name.replace(/\s+/g, '_')}.srt`;
                a.click();
                URL.revokeObjectURL(url);
              }}
              title="Download SRT"
              className="p-1.5 bg-[#1F1F26] hover:bg-[#2A2A34] border border-[#2F2F39] text-[#D4D4DC] rounded cursor-pointer"
            >
              <Download className="w-3 h-3" />
            </button>
          </div>

          {transcriptError && (
            <div className="p-2 rounded bg-[#2B1418] border border-[#EF4444]/40 text-[11px] text-[#FCA5A5]">
              {transcriptError}
            </div>
          )}

          <input
            type="text"
            value={transcriptSearch}
            onChange={(e) => setTranscriptSearch(e.target.value)}
            placeholder="Search transcript..."
            className="w-full bg-[#121215] border border-[#27272E] rounded px-2.5 py-1 text-xs text-white outline-none"
          />

          <div className="space-y-1.5 max-h-60 overflow-y-auto">
            {visibleCaptions.map((cap) => (
              <div
                key={cap.id}
                className="p-2 rounded bg-[#131317] border border-[#27272E] space-y-1"
              >
                <div className="flex items-center justify-between text-[10px] font-mono-tabular text-[#60A5FA]">
                  <button
                    type="button"
                    onClick={() => onSeek(cap.start)}
                    className="hover:underline cursor-pointer"
                  >
                    {formatTimecode(cap.start, sequence.fps)} · {cap.speaker}
                  </button>
                  <button
                    type="button"
                    onClick={() => onUpdateCaptions(captions.filter((c) => c.id !== cap.id))}
                    className="text-[#7D7D8A] hover:text-[#F87171] cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
                <textarea
                  rows={2}
                  value={cap.text}
                  onChange={(e) =>
                    onUpdateCaptions(
                      captions.map((c) => (c.id === cap.id ? { ...c, text: e.target.value } : c))
                    )
                  }
                  className="w-full bg-transparent text-[11px] text-[#E4E4EC] outline-none resize-none"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {subMode === 'voiceover' && (
        <div className="space-y-3">
          <div className="p-2.5 rounded bg-[#131317] border border-[#27272E] space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[#E4E4EC] flex items-center gap-1.5">
                <Mic className="w-3.5 h-3.5 text-[#3B82F6]" />
                AI Narration Voiceover
              </span>
              <select
                value={voVoice}
                onChange={(e) => setVoVoice(e.target.value)}
                className="bg-[#1B1B22] border border-[#2C2C35] rounded px-1.5 py-0.5 text-[11px] text-[#D4D4DC] outline-none"
              >
                <option value="Kore">Kore</option>
                <option value="Puck">Puck</option>
                <option value="Charon">Charon</option>
                <option value="Fenrir">Fenrir</option>
                <option value="Zephyr">Zephyr</option>
              </select>
            </div>
            <textarea
              rows={3}
              value={voScript}
              onChange={(e) => setVoScript(e.target.value)}
              className="w-full bg-[#101014] border border-[#27272E] rounded p-2 text-xs text-white outline-none resize-none"
            />
            {voError && <p className="text-[11px] text-[#FCA5A5]">{voError}</p>}
            <button
              type="button"
              disabled={voBusy || !voScript.trim()}
              onClick={handleGenerateVoiceover}
              className="w-full py-1.5 text-xs font-medium bg-[#2563EB] hover:bg-[#3B82F6] text-white rounded disabled:opacity-45 cursor-pointer"
            >
              {voBusy ? 'Synthesizing Voiceover...' : 'Generate Voiceover to Timeline'}
            </button>
          </div>

          <div className="p-2.5 rounded bg-[#131317] border border-[#27272E] space-y-2">
            <div className="text-xs font-semibold text-[#E4E4EC] flex items-center gap-1.5">
              <Scissors className="w-3.5 h-3.5 text-[#F59E0B]" />
              Scene Edit Detection
            </div>
            <p className="text-[10px] text-[#8E8E9B]">
              Detects visual cut points in the selected clip and automatically splits it on the timeline.
            </p>
            <button
              type="button"
              disabled={!selectedClip || sceneBusy}
              onClick={handleRunSceneDetect}
              className="w-full py-1.5 text-xs font-medium bg-[#222229] hover:bg-[#2E2E38] border border-[#32323D] text-[#E4E4EC] rounded disabled:opacity-45 cursor-pointer"
            >
              {sceneBusy ? 'Scanning Frames...' : 'Detect Scene Cuts'}
            </button>
            {sceneMessage && <p className="text-[10px] text-[#93C5FD]">{sceneMessage}</p>}
          </div>

          <div className="p-2.5 rounded bg-[#131317] border border-[#27272E] space-y-2">
            <div className="text-xs font-semibold text-[#E4E4EC] flex items-center gap-1.5">
              <Wand2 className="w-3.5 h-3.5 text-[#14B8A6]" />
              Audio Music Remix
            </div>
            <p className="text-[10px] text-[#8E8E9B]">
              Retimes and fits music stems on A1/A2 cleanly to match the exact video sequence duration.
            </p>
            <button
              type="button"
              onClick={onRemixMusicToSequence}
              className="w-full py-1.5 text-xs font-medium bg-[#222229] hover:bg-[#2E2E38] border border-[#32323D] text-[#E4E4EC] rounded cursor-pointer"
            >
              <Sparkles className="w-3 h-3 inline mr-1.5 text-[#14B8A6]" />
              Remix Music to Sequence
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

interface ReviewTabProps {
  playhead: number;
  sequence: SequenceSettings;
  comments: ReviewComment[];
  versions: ProjectVersion[];
  onAddComment: (text: string) => void;
  onToggleResolveComment: (id: string) => void;
  onDeleteComment: (id: string) => void;
  onSaveVersion: (name: string) => void;
  onRestoreVersion: (versionId: string) => void;
  onSeek: (time: number) => void;
}

export function ReviewAndVersionsTab({
  playhead,
  sequence,
  comments,
  versions,
  onAddComment,
  onToggleResolveComment,
  onDeleteComment,
  onSaveVersion,
  onRestoreVersion,
  onSeek,
}: ReviewTabProps) {
  const [note, setNote] = useState('');
  const [verName, setVerName] = useState('');

  return (
    <div className="space-y-4">
      {/* Frame.io-Style Review Comments */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-[#D4D4DC] flex items-center gap-1.5">
            <MessageSquare className="w-3.5 h-3.5 text-[#3B82F6]" />
            Timeline Review Notes
          </h3>
          <span className="text-[10px] font-mono-tabular text-[#7D7D8A]">
            {formatTimecode(playhead, sequence.fps)}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && note.trim()) {
                onAddComment(note.trim());
                setNote('');
              }
            }}
            placeholder="Pin comment at playhead..."
            className="flex-1 bg-[#111115] border border-[#2B2B34] rounded px-2.5 py-1.5 text-xs text-white outline-none"
          />
          <button
            type="button"
            disabled={!note.trim()}
            onClick={() => {
              if (note.trim()) {
                onAddComment(note.trim());
                setNote('');
              }
            }}
            className="px-2.5 py-1.5 text-xs font-medium bg-[#2563EB] hover:bg-[#3B82F6] text-white rounded disabled:opacity-40 cursor-pointer"
          >
            Post
          </button>
        </div>

        <div className="space-y-1.5 max-h-52 overflow-y-auto">
          {comments.map((cm) => (
            <div
              key={cm.id}
              className={`p-2 rounded border space-y-1 ${
                cm.resolved
                  ? 'bg-[#121216] border-[#222229] opacity-60'
                  : 'bg-[#15151B] border-[#2B2B34]'
              }`}
            >
              <div className="flex items-center justify-between text-[10px]">
                <button
                  type="button"
                  onClick={() => onSeek(cm.time)}
                  className="font-mono-tabular text-[#60A5FA] hover:underline cursor-pointer"
                >
                  {formatTimecode(cm.time, sequence.fps)} · {cm.author}
                </button>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onToggleResolveComment(cm.id)}
                    title="Resolve"
                    className={`cursor-pointer ${cm.resolved ? 'text-[#10B981]' : 'text-[#7D7D8A] hover:text-white'}`}
                  >
                    <CheckCircle2 className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteComment(cm.id)}
                    className="text-[#7D7D8A] hover:text-[#F87171] cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
              <p className="text-[11px] text-[#D4D4DC]">{cm.text}</p>
            </div>
          ))}
        </div>
      </section>

      <hr className="border-[#25252D]" />

      {/* Team Projects / Version Snapshots */}
      <section className="space-y-2">
        <h3 className="text-xs font-semibold text-[#D4D4DC]">Project Version History</h3>
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            value={verName}
            onChange={(e) => setVerName(e.target.value)}
            placeholder="Snapshot name (e.g. Director Cut v2)"
            className="flex-1 bg-[#111115] border border-[#2B2B34] rounded px-2.5 py-1.5 text-xs text-white outline-none"
          />
          <button
            type="button"
            onClick={() => {
              onSaveVersion(verName.trim() || `Cut v${versions.length + 1}`);
              setVerName('');
            }}
            className="px-2.5 py-1.5 text-xs font-medium bg-[#222229] hover:bg-[#2E2E38] border border-[#32323D] text-white rounded cursor-pointer"
          >
            Save
          </button>
        </div>

        <div className="space-y-1.5">
          {versions.length === 0 ? (
            <p className="text-[11px] text-[#7D7D8A]">No saved snapshots yet.</p>
          ) : (
            versions.map((v) => (
              <div
                key={v.id}
                className="px-2.5 py-2 rounded bg-[#131317] border border-[#27272E] flex items-center justify-between gap-2"
              >
                <div className="min-w-0">
                  <div className="text-xs font-medium text-[#E4E4EC] truncate">{v.name}</div>
                  <div className="text-[10px] text-[#7D7D8A] font-mono-tabular">{v.createdAt}</div>
                </div>
                <button
                  type="button"
                  onClick={() => onRestoreVersion(v.id)}
                  className="px-2 py-1 text-[10px] font-medium bg-[#2563EB]/20 hover:bg-[#2563EB] text-[#93C5FD] hover:text-white rounded cursor-pointer shrink-0"
                >
                  Restore
                </button>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
