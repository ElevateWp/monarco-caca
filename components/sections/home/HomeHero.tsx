'use client';

import { useCallback, useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { CLINIC_INFO } from '@/lib/clinic-data';
import { isReducedMotion } from '@/lib/motion';

const FRAME_COUNT = 300;
const framePath = (index: number) =>
  `/frames/monarca/ezgif-frame-${String(index + 1).padStart(3, '0')}.jpg`;

if (typeof window !== 'undefined') gsap.registerPlugin(ScrollTrigger);

export default function HomeHero() {
  const sectionRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const framesRef = useRef(new Map<number, HTMLImageElement>());
  const targetFrameRef = useRef(0);
  const drawRef = useRef<(index: number) => void>(() => undefined);
  const requestRef = useRef<(index: number) => void>(() => undefined);

  const drawFrame = useCallback((index: number) => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;

    const frames = framesRef.current;
    let image = frames.get(index);
    if (!image?.complete || !image.naturalWidth) {
      // Fall back to the nearest decoded frame while the requested one loads.
      let nearestDistance = Number.POSITIVE_INFINITY;
      for (const [frameIndex, candidate] of frames) {
        const distance = Math.abs(frameIndex - index);
        if (distance < nearestDistance && candidate.complete && candidate.naturalWidth) {
          nearestDistance = distance;
          image = candidate;
        }
      }
    }
    if (!image?.naturalWidth) return;

    const scale = Math.max(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
  }, []);

  drawRef.current = drawFrame;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';

    const resizeCanvas = () => {
      const rect = canvas.getBoundingClientRect();
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(rect.width * pixelRatio);
      canvas.height = Math.round(rect.height * pixelRatio);
      drawRef.current(targetFrameRef.current);
    };
    resizeCanvas();
    const observer = new ResizeObserver(resizeCanvas);
    observer.observe(canvas);

    const activeLoads = new Map<number, HTMLImageElement>();
    let queue: number[] = [];
    let disposed = false;
    let drawScheduled = false;

    const drawLatestFrame = () => {
      if (drawScheduled) return;
      drawScheduled = true;
      requestAnimationFrame(() => {
        drawScheduled = false;
        if (!disposed) drawRef.current(targetFrameRef.current);
      });
    };

    const pumpQueue = () => {
      while (!disposed && activeLoads.size < 6 && queue.length > 0) {
        const frameIndex = queue.shift();
        if (frameIndex === undefined || framesRef.current.has(frameIndex)) continue;

        const image = new Image();
        image.decoding = 'async';
        framesRef.current.set(frameIndex, image);
        activeLoads.set(frameIndex, image);
        image.onload = () => {
          activeLoads.delete(frameIndex);
          drawLatestFrame();
          pumpQueue();
        };
        image.onerror = () => {
          activeLoads.delete(frameIndex);
          framesRef.current.delete(frameIndex);
          pumpQueue();
        };
        image.src = framePath(frameIndex);
      }
    };

    const requestFrame = (index: number) => {
      const bounded = Math.max(0, Math.min(FRAME_COUNT - 1, index));
      const previous = targetFrameRef.current;
      if (bounded === previous && framesRef.current.has(bounded)) {
        drawLatestFrame();
        return;
      }
      targetFrameRef.current = bounded;
      const cache = framesRef.current;
      const first = Math.max(0, bounded - 6);
      const last = Math.min(FRAME_COUNT - 1, bounded + 10);

      // Discard stale queued work and keep no more than four frame downloads active.
      const direction = bounded >= previous ? 1 : -1;
      const wanted = [bounded];
      for (let offset = 1; offset <= 8; offset += 1) {
        const ahead = bounded + offset * direction;
        if (ahead >= 0 && ahead < FRAME_COUNT) wanted.push(ahead);
        if (offset <= 3) {
          const behind = bounded - offset * direction;
          if (behind >= 0 && behind < FRAME_COUNT) wanted.push(behind);
        }
      }
      queue = wanted.filter((frameIndex) => !cache.has(frameIndex));

      for (const [cachedIndex, image] of cache) {
        if (cachedIndex < first || cachedIndex > last) {
          if (activeLoads.get(cachedIndex) === image) activeLoads.delete(cachedIndex);
          image.onload = null;
          image.onerror = null;
          image.src = '';
          cache.delete(cachedIndex);
        }
      }

      // Keep the target and nearby frames in flight; abort distant requests so
      // they cannot occupy every slot after a fast scroll or direction change.
      for (const [frameIndex, image] of activeLoads) {
        if (Math.abs(frameIndex - bounded) > 4) {
          activeLoads.delete(frameIndex);
          cache.delete(frameIndex);
          image.onload = null;
          image.onerror = null;
          image.src = '';
        }
      }

      drawLatestFrame();
      pumpQueue();
    };
    requestRef.current = requestFrame;

    const cleanup = () => {
      disposed = true;
      queue = [];
      for (const image of activeLoads.values()) {
        image.onload = null;
        image.onerror = null;
        image.src = '';
      }
      activeLoads.clear();
      framesRef.current.clear();
      observer.disconnect();
    };

    requestFrame(isReducedMotion() ? FRAME_COUNT - 1 : 0);

    if (isReducedMotion() || !sectionRef.current) return cleanup;

    const section = sectionRef.current;
    const playhead = { frame: 0 };
    const tween = gsap.to(playhead, {
      frame: FRAME_COUNT - 1,
      ease: 'none',
      onUpdate: () => requestRef.current(Math.round(playhead.frame)),
      scrollTrigger: {
        trigger: section,
        start: 'top top',
        end: '+=420%',
        // Lenis already smooths wheel input; an additional timed scrub made
        // the hero trail behind fast scrolling, so keep the frame tied to the
        // current (already smoothed) scroll position.
        scrub: true,
        pin: true,
        pinSpacing: true,
        anticipatePin: 1,
        invalidateOnRefresh: true,
      },
    });

    return () => {
      tween.scrollTrigger?.kill();
      tween.kill();
      cleanup();
    };
  }, []);

  return (
    <section ref={sectionRef} className="relative h-[100svh] min-h-[560px] w-full overflow-hidden bg-[#1A1A1A]">
      <canvas
        ref={canvasRef}
        aria-label="Sequência visual em tela cheia, controlada pela rolagem"
        className="absolute inset-0 h-full w-full"
      />
      <div aria-hidden="true" className="absolute inset-0 bg-[linear-gradient(90deg,rgba(23,19,19,.58)_0%,rgba(23,19,19,.2)_48%,rgba(23,19,19,0)_82%),linear-gradient(0deg,rgba(23,19,19,.72)_0%,rgba(23,19,19,.08)_58%,rgba(23,19,19,.04)_100%)]" />

      <div className="absolute inset-x-0 bottom-0 z-10 mx-auto flex w-full max-w-site flex-col items-start px-5 pb-10 pt-20 text-white sm:px-8 sm:pb-14 md:px-12 md:pb-16">
        <p className="mb-4 font-body text-[11px] uppercase tracking-[.18em] text-white/80 sm:text-xs">
          Caça vazamentos · Desentupimento · Manutenção geral
        </p>
        <h1 className="max-w-4xl font-display text-4xl font-normal leading-[1.02] tracking-[-.035em] sm:text-5xl md:text-6xl lg:text-7xl">
          Monarca <span className="text-[#FFE2D1]">Caça Vazamentos</span>
        </h1>
        <p className="mt-4 max-w-2xl font-body text-sm leading-relaxed text-white/90 sm:text-base md:text-lg">
          Caça vazamentos, desentupimento e manutenção hidráulica em Caieiras e região. Atendimento 24 horas.
        </p>

        <div className="mt-7 flex flex-wrap items-center gap-3 sm:gap-4">
          <a
            href={`tel:${CLINIC_INFO.contact.phone.replace(/[^0-9+]/g, '')}`}
            className="inline-flex min-h-12 items-center justify-center bg-[#FF681F] px-6 font-body text-sm font-medium text-white transition-colors hover:bg-[#F4511E] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            Ligar: +55 11 97547-5490
          </a>
          <span className="font-body text-xs text-white/85 sm:text-sm">Atendimento 24 horas</span>
        </div>
      </div>

      <div aria-hidden="true" className="pointer-events-none absolute bottom-5 right-5 z-10 flex items-center gap-3 text-[10px] uppercase tracking-[.18em] text-white/80 sm:bottom-8 sm:right-10">
        <span>Role para explorar</span>
        <span className="h-px w-8 bg-white/70" />
      </div>
    </section>
  );
}
