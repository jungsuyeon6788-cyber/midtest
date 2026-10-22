"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import Image from "next/image";
import confetti from "canvas-confetti";
import { soundEffects } from "@/lib/sound";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Heart,
  Play,
  Pause,
  RotateCcw,
  Trophy,
  Frown,
  Volume2,
  VolumeX,
  User,
  ArrowLeftRight,
  Flame,
  Medal,
  Clock,
} from "lucide-react";

// 리더보드 항목 타입
interface LeaderboardItem {
  rank: number;
  name: string;
  finishtime: string;
  timestamp?: string;
}

// 색상 정의 (파스텔 톤 6종)
const COLORS = {
  LIGHT_RED: "#ff9999", // 목표 타겟 색상 (30% 할당)
  LIGHT_ORANGE: "#ffcc99",
  LIGHT_YELLOW: "#ffff99",
  LIGHT_GREEN: "#b3e6b3",
  LIGHT_BLUE: "#99ccff",
  LIGHT_PURPLE: "#d9b3ff",
};

const OTHER_COLORS = [
  COLORS.LIGHT_ORANGE,
  COLORS.LIGHT_YELLOW,
  COLORS.LIGHT_GREEN,
  COLORS.LIGHT_BLUE,
  COLORS.LIGHT_PURPLE,
];

interface Brick {
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  isTarget: boolean;
  intact: boolean;
}

type GameState = "INTRO" | "COUNTDOWN" | "PLAYING" | "PAUSED" | "VICTORY" | "GAME_OVER";

export default function BrickBreakerGame() {
  const [userName, setUserName] = useState<string>("");
  const [gameState, setGameState] = useState<GameState>("INTRO");
  const [countdown, setCountdown] = useState<number>(3);
  const [lives, setLives] = useState<number>(3);
  const [targetDestroyed, setTargetDestroyed] = useState<number>(0);
  const [elapsedTime, setElapsedTime] = useState<number>(0);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);
  const [top3, setTop3] = useState<LeaderboardItem[]>([]);
  const [isLoadingLeaderboard, setIsLoadingLeaderboard] = useState<boolean>(false);

  // 구글 앱스 스크립트 웹 앱 배포 URL
  const GOOGLE_SCRIPT_URL = process.env.NEXT_PUBLIC_GOOGLE_SCRIPT_URL || "";

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const bgmRef = useRef<HTMLAudioElement | null>(null);

  // 내부 게임 상태 ref
  const gameRef = useRef({
    paddle: { x: 350, y: 550, width: 104, height: 14, vx: 0, maxSpeed: 8.5, accel: 0.9, friction: 0.88 },
    ball: { x: 400, y: 530, radius: 8, dx: 4, dy: -4, speed: 5.5, inPlay: false },
    bricks: [] as Brick[],
    targetDestroyedCount: 0,
    keys: { left: false, right: false },
    isTouchActive: false,
    touchStartX: 0,
    touchCurrentX: 0,
    canvasLogicalWidth: 800,
    canvasLogicalHeight: 600,
  });

  // 배경 음악 관리 (Hyper_Speed_Run.mp3)
  useEffect(() => {
    const audio = new Audio("/Hyper_Speed_Run.mp3");
    audio.loop = true;
    audio.volume = 0.22; // 너무 크지 않도록 적절한 볼륨 설정
    bgmRef.current = audio;

    return () => {
      audio.pause();
      audio.src = "";
    };
  }, []);

  // 게임 상태에 따른 배경 음악 재생/정지
  useEffect(() => {
    const audio = bgmRef.current;
    if (!audio) return;

    if (isMuted) {
      audio.pause();
      return;
    }

    if (gameState === "PLAYING" || gameState === "COUNTDOWN") {
      audio.play().catch(() => {
        // 자동 재생 제한 등으로 실패한 경우 무시
      });
    } else if (gameState === "PAUSED") {
      audio.pause();
    } else {
      // INTRO, VICTORY, GAME_OVER 일 때는 멈추고 처음으로
      audio.pause();
      audio.currentTime = 0;
    }
  }, [gameState, isMuted]);

  // 타이머 핸들러
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (gameState === "PLAYING") {
      timer = setInterval(() => {
        setElapsedTime((prev) => prev + 1);
      }, 1000);
    } else if (gameState === "VICTORY") {
      // 미션 성공 시에만 구글 스프레드시트에 자동 전송 (중단 시에는 미호출)
      sendGameRecordToSheet(userName, formatTime(elapsedTime));
    }
    return () => clearInterval(timer);
  }, [gameState]);

  // 카운트다운 핸들러
  useEffect(() => {
    if (gameState === "COUNTDOWN") {
      setCountdown(3);
      const interval = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(interval);
            setGameState("PLAYING");
            launchBall();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [gameState]);

  // 초를 mm:ss 포맷으로 변환
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  };

  // 벽돌 5x8 = 40개 생성 (연한 빨강 30% = 12개 고정)
  const createBricks = useCallback(() => {
    const rows = 5;
    const cols = 8;
    const brickWidth = 84;
    const brickHeight = 26;
    const padding = 10;
    const offsetTop = 60;
    const offsetLeft = 32;

    const total = rows * cols; // 40
    const targetCount = 12; // 30% = 12개

    const indices = Array.from({ length: total }, (_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    const targetIndices = new Set(indices.slice(0, targetCount));

    const bricks: Brick[] = [];
    let idx = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const isTarget = targetIndices.has(idx);
        const color = isTarget
          ? COLORS.LIGHT_RED
          : OTHER_COLORS[Math.floor(Math.random() * OTHER_COLORS.length)];

        bricks.push({
          x: offsetLeft + c * (brickWidth + padding),
          y: offsetTop + r * (brickHeight + padding),
          width: brickWidth,
          height: brickHeight,
          color,
          isTarget,
          intact: true,
        });
        idx++;
      }
    }
    return bricks;
  }, []);

  // 공 & 패들 위치 리셋
  const resetBallAndPaddle = useCallback(() => {
    const { canvasLogicalWidth, canvasLogicalHeight, paddle } = gameRef.current;
    paddle.x = (canvasLogicalWidth - paddle.width) / 2;
    paddle.y = canvasLogicalHeight - 45;
    gameRef.current.ball = {
      x: canvasLogicalWidth / 2,
      y: paddle.y - 10,
      radius: 8,
      dx: 0,
      dy: 0,
      speed: 5.5,
      inPlay: false,
    };
  }, []);

  // 공 발사
  const launchBall = () => {
    const angle = (Math.random() * 60 - 30) * (Math.PI / 180);
    const speed = 5.5;
    gameRef.current.ball.dx = speed * Math.sin(angle);
    gameRef.current.ball.dy = -speed * Math.cos(angle);
    gameRef.current.ball.inPlay = true;
  };

  // 게임 시작하기
  const handleStartGame = () => {
    if (!userName.trim()) return;

    gameRef.current.bricks = createBricks();
    gameRef.current.targetDestroyedCount = 0;
    resetBallAndPaddle();
    setLives(3);
    setTargetDestroyed(0);
    setElapsedTime(0);
    setSaveSuccess(false);
    setIsSaving(false);
    setGameState("COUNTDOWN");
  };

  // 로컬 스토리지 키
  const STORAGE_KEY = "inu_brick_breaker_top3";

  // 구글 스프레드시트에서 Top 3 리더보드 데이터 가져오기 (실패 시 로컬 데이터 백업 활용)
  const fetchLeaderboard = useCallback(async () => {
    // 1. 먼저 로컬에 캐시된 Top 3 불러오기
    try {
      const cached = localStorage.getItem(STORAGE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setTop3(parsed);
        }
      }
    } catch {
      // 무시
    }

    if (!GOOGLE_SCRIPT_URL) return;

    // 2. 구글 앱스 스크립트에서 최신 Top 3 fetch 시도
    try {
      setIsLoadingLeaderboard(true);
      const res = await fetch(`${GOOGLE_SCRIPT_URL}?action=getTop3`);
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.top3) && data.top3.length > 0) {
          setTop3(data.top3);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(data.top3));
        }
      }
    } catch {
      // GAS 엔드포인트 응답 지연/텍스트 응답 시 무시
    } finally {
      setIsLoadingLeaderboard(false);
    }
  }, [GOOGLE_SCRIPT_URL]);

  // 첫 화면 마운트 시 리더보드 조회
  useEffect(() => {
    fetchLeaderboard();
  }, [fetchLeaderboard]);

  // 로컬 및 화면 리더보드에 즉시 현재 기록 반영
  const updateLocalTop3 = useCallback((playerName: string, finishTimeStr: string, seconds: number) => {
    setTop3((prev) => {
      const list = [...prev];
      // "mm:ss" 형식을 초 단위로 변환해 비교
      const toSec = (timeStr: string) => {
        const parts = timeStr.split(":");
        return parts.length === 2 ? parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10) : 999999;
      };

      list.push({
        rank: 0,
        name: playerName,
        finishtime: finishTimeStr,
      });

      // 가장 빠른 순서(초 오름차순) 정렬
      list.sort((a, b) => toSec(a.finishtime) - toSec(b.finishtime));
      const updated = list.slice(0, 3).map((item, idx) => ({
        ...item,
        rank: idx + 1,
      }));

      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      } catch {
        // 무시
      }
      return updated;
    });
  }, []);

  // 구글 스프레드시트로 성공 데이터 전송 (완료 시에만 전송, 중단 시에는 호출되지 않음)
  const sendGameRecordToSheet = async (player: string, finishTimeStr: string) => {
    // 1. 화면에 Top 3 즉시 반영 (네트워크 딜레이 없이 100% 즉시 표시)
    updateLocalTop3(player, finishTimeStr, elapsedTime);

    if (!GOOGLE_SCRIPT_URL) return;

    try {
      setIsSaving(true);
      // 구글 앱스 스크립트 웹 앱으로 POST 요청 (CORS 대응 mode: no-cors 사용)
      await fetch(GOOGLE_SCRIPT_URL, {
        method: "POST",
        mode: "no-cors",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: player,
          finishtime: finishTimeStr,
        }),
      });
      setSaveSuccess(true);
      // 스프레드시트 반영 후 백그라운드 재동기화
      setTimeout(() => {
        fetchLeaderboard();
      }, 1500);
    } catch {
      // 전송 오류 시 무시
    } finally {
      setIsSaving(false);
    }
  };

  // 게임 일시정지 / 계속하기
  const handleTogglePause = () => {
    if (gameState === "PLAYING") {
      setGameState("PAUSED");
    } else if (gameState === "PAUSED") {
      setGameState("PLAYING");
    }
  };

  // 게임 종료 -> 이름 입력 첫 화면 복귀 (중단 시에는 스프레드시트에 저장하지 않음)
  const handleEndGame = () => {
    setGameState("INTRO");
    setElapsedTime(0);
    setLives(3);
    setTargetDestroyed(0);
    setSaveSuccess(false);
    setIsSaving(false);
  };

  // 승리 폭죽 효과
  const triggerConfetti = () => {
    if (!isMuted) {
      soundEffects.playVictorySound();
    }
    const duration = 3.5 * 1000;
    const end = Date.now() + duration;

    const frame = () => {
      confetti({
        particleCount: 4,
        angle: 60,
        spread: 55,
        origin: { x: 0, y: 0.7 },
        colors: ["#2563eb", "#38bdf8", "#ff9999", "#ffcc99", "#ffff99"],
      });
      confetti({
        particleCount: 4,
        angle: 120,
        spread: 55,
        origin: { x: 1, y: 0.7 },
        colors: ["#2563eb", "#38bdf8", "#ff9999", "#ffcc99", "#ffff99"],
      });

      if (Date.now() < end) {
        requestAnimationFrame(frame);
      }
    };
    frame();
  };

  // 키보드 조작 이벤트
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        gameRef.current.keys.left = true;
      } else if (e.key === "ArrowRight") {
        gameRef.current.keys.right = true;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        gameRef.current.keys.left = false;
      } else if (e.key === "ArrowRight") {
        gameRef.current.keys.right = false;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  // 패들 X 위치를 캔버스 기준 좌표로 업데이트하는 함수
  const updatePaddlePositionFromClientX = useCallback((clientX: number) => {
    if (gameState !== "PLAYING") return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const scale = gameRef.current.canvasLogicalWidth / rect.width;
    const canvasX = (clientX - rect.left) * scale;

    const { paddle, canvasLogicalWidth } = gameRef.current;
    let newPaddleX = canvasX - paddle.width / 2;

    if (newPaddleX < 0) newPaddleX = 0;
    if (newPaddleX + paddle.width > canvasLogicalWidth) {
      newPaddleX = canvasLogicalWidth - paddle.width;
    }
    paddle.x = newPaddleX;
  }, [gameState]);

  // 모바일 전용 터치 위치 추종 (PC에서는 마우스로 패들이 움직이지 않고 방향키로만 조작됨)
  useEffect(() => {
    if (gameState !== "PLAYING") return;

    // 터치 디바이스 여부 감지
    const isTouchDevice = () => {
      return "ontouchstart" in window || navigator.maxTouchPoints > 0;
    };

    if (!isTouchDevice()) return; // PC 환경일 경우 마우스 추종 비활성화 (오직 키보드 방향키로만 조작)

    const handleGlobalTouchMove = (e: TouchEvent) => {
      if (e.touches.length > 0) {
        updatePaddlePositionFromClientX(e.touches[0].clientX);
      }
    };

    const handleGlobalPointerMove = (e: PointerEvent) => {
      // 터치 포인터일 때만 패들 이동
      if (e.pointerType === "touch" || e.pointerType === "pen") {
        updatePaddlePositionFromClientX(e.clientX);
      }
    };

    window.addEventListener("touchmove", handleGlobalTouchMove, { passive: true });
    window.addEventListener("pointermove", handleGlobalPointerMove, { passive: true });

    return () => {
      window.removeEventListener("touchmove", handleGlobalTouchMove);
      window.removeEventListener("pointermove", handleGlobalPointerMove);
    };
  }, [gameState, updatePaddlePositionFromClientX]);

  // 애니메이션 렌더링 루프
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationFrameId: number;

    const render = () => {
      const {
        canvasLogicalWidth,
        canvasLogicalHeight,
        paddle,
        ball,
        bricks,
        keys,
      } = gameRef.current;

      ctx.clearRect(0, 0, canvasLogicalWidth, canvasLogicalHeight);

      // 아무런 무늬가 없는 완전한 순백색 무지 배경 (#ffffff)
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvasLogicalWidth, canvasLogicalHeight);

      if (gameState === "PLAYING") {
        // 1. 패들 이동 (PC 키보드 좌우 방향키로 부드러운 가속 및 자연스러운 감속 이동)
        if (keys.left) {
          paddle.vx -= paddle.accel;
        } else if (keys.right) {
          paddle.vx += paddle.accel;
        } else {
          // 키를 뗐을 때 부드러운 마찰력 감속
          paddle.vx *= paddle.friction;
        }

        // 최대 속도 제한
        if (paddle.vx > paddle.maxSpeed) paddle.vx = paddle.maxSpeed;
        if (paddle.vx < -paddle.maxSpeed) paddle.vx = -paddle.maxSpeed;

        // 위치 갱신
        paddle.x += paddle.vx;

        // 캔버스 벽 충돌 제한 및 속도 상쇄
        if (paddle.x < 0) {
          paddle.x = 0;
          paddle.vx = 0;
        }
        if (paddle.x + paddle.width > canvasLogicalWidth) {
          paddle.x = canvasLogicalWidth - paddle.width;
          paddle.vx = 0;
        }

        // 2. 공 물리 이동
        if (ball.inPlay) {
          ball.x += ball.dx;
          ball.y += ball.dy;

          // 좌우 벽 충돌
          if (ball.x - ball.radius < 0) {
            ball.x = ball.radius;
            ball.dx = -ball.dx;
          } else if (ball.x + ball.radius > canvasLogicalWidth) {
            ball.x = canvasLogicalWidth - ball.radius;
            ball.dx = -ball.dx;
          }

          // 상단 벽 충돌
          if (ball.y - ball.radius < 0) {
            ball.y = ball.radius;
            ball.dy = -ball.dy;
          }

          // 패들과 충돌
          if (
            ball.y + ball.radius >= paddle.y &&
            ball.y - ball.radius <= paddle.y + paddle.height &&
            ball.x + ball.radius >= paddle.x &&
            ball.x - ball.radius <= paddle.x + paddle.width &&
            ball.dy > 0
          ) {
            const hitPoint = (ball.x - (paddle.x + paddle.width / 2)) / (paddle.width / 2);
            const clampedHit = Math.max(-0.9, Math.min(0.9, hitPoint));
            const maxAngle = (65 * Math.PI) / 180;
            const reflectionAngle = clampedHit * maxAngle;

            const speed = ball.speed;
            ball.dx = speed * Math.sin(reflectionAngle);
            ball.dy = -Math.abs(speed * Math.cos(reflectionAngle));
            ball.y = paddle.y - ball.radius;

            if (!isMuted) soundEffects.playPaddleSound();
          }

          // 벽돌과의 충돌
          for (let i = 0; i < bricks.length; i++) {
            const b = bricks[i];
            if (!b.intact) continue;

            const nearestX = Math.max(b.x, Math.min(ball.x, b.x + b.width));
            const nearestY = Math.max(b.y, Math.min(ball.y, b.y + b.height));
            const distX = ball.x - nearestX;
            const distY = ball.y - nearestY;

            if (distX * distX + distY * distY < ball.radius * ball.radius) {
              b.intact = false;
              if (!isMuted) soundEffects.playHitSound(b.isTarget);

              if (b.isTarget) {
                gameRef.current.targetDestroyedCount += 1;
                const newCount = gameRef.current.targetDestroyedCount;
                setTargetDestroyed(newCount);

                if (newCount >= 3) {
                  setGameState("VICTORY");
                  triggerConfetti();
                  return;
                }
              }

              const overlapLeft = ball.x + ball.radius - b.x;
              const overlapRight = b.x + b.width - (ball.x - ball.radius);
              const overlapTop = ball.y + ball.radius - b.y;
              const overlapBottom = b.y + b.height - (ball.y - ball.radius);

              const minOverlapX = Math.min(overlapLeft, overlapRight);
              const minOverlapY = Math.min(overlapTop, overlapBottom);

              if (minOverlapX < minOverlapY) {
                ball.dx = -ball.dx;
              } else {
                ball.dy = -ball.dy;
              }
              break;
            }
          }

          // 화면 하단으로 공이 떨어진 경우
          if (ball.y - ball.radius > canvasLogicalHeight) {
            if (!isMuted) soundEffects.playLifeLostSound();
            setLives((prevLives) => {
              const newLives = prevLives - 1;
              if (newLives <= 0) {
                setGameState("GAME_OVER");
              } else {
                resetBallAndPaddle();
                setTimeout(() => {
                  launchBall();
                }, 400);
              }
              return newLives;
            });
          }
        }
      }

      // 1. 벽돌 그리기
      bricks.forEach((b) => {
        if (!b.intact) return;

        ctx.save();
        ctx.fillStyle = b.color;
        ctx.strokeStyle = "rgba(0, 0, 0, 0.15)";
        ctx.lineWidth = 1.2;

        const r = 5;
        ctx.beginPath();
        ctx.roundRect(b.x, b.y, b.width, b.height, r);
        ctx.fill();
        ctx.stroke();

        // 타겟(연한 빨강) 블록 강조
        if (b.isTarget) {
          ctx.strokeStyle = "#ef4444";
          ctx.lineWidth = 2.2;
          ctx.stroke();

          // 빛나는 타겟 도트
          ctx.fillStyle = "#ffffff";
          ctx.beginPath();
          ctx.arc(b.x + b.width - 8, b.y + 8, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.restore();
      });

      // 2. 패들 그리기 (INU 파란색 톤)
      ctx.save();
      const paddleGrad = ctx.createLinearGradient(
        paddle.x,
        paddle.y,
        paddle.x,
        paddle.y + paddle.height
      );
      paddleGrad.addColorStop(0, "#2563eb"); // blue-600
      paddleGrad.addColorStop(1, "#1d4ed8"); // blue-700
      ctx.fillStyle = paddleGrad;
      ctx.shadowColor = "rgba(37, 99, 235, 0.4)";
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.roundRect(paddle.x, paddle.y, paddle.width, paddle.height, 7);
      ctx.fill();
      ctx.restore();

      // 3. 공 그리기 (선명한 짙은 슬레이트/네이비 톤)
      ctx.save();
      ctx.fillStyle = "#1e293b";
      ctx.shadowColor = "rgba(0, 0, 0, 0.3)";
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // 4. 카운트다운 오버레이
      if (gameState === "COUNTDOWN") {
        ctx.save();
        ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
        ctx.fillRect(0, 0, canvasLogicalWidth, canvasLogicalHeight);

        ctx.fillStyle = "#2563eb";
        ctx.font = "900 96px Pretendard, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(countdown), canvasLogicalWidth / 2, canvasLogicalHeight / 2 - 20);

        ctx.font = "700 24px Pretendard, sans-serif";
        ctx.fillStyle = "#475569";
        ctx.fillText("준비하세요! 게임이 곧 시작됩니다.", canvasLogicalWidth / 2, canvasLogicalHeight / 2 + 55);
        ctx.restore();
      } else if (gameState === "PAUSED") {
        ctx.save();
        ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
        ctx.fillRect(0, 0, canvasLogicalWidth, canvasLogicalHeight);

        ctx.fillStyle = "#2563eb";
        ctx.font = "800 44px Pretendard, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("일시 정지됨", canvasLogicalWidth / 2, canvasLogicalHeight / 2 - 15);

        ctx.font = "500 18px Pretendard, sans-serif";
        ctx.fillStyle = "#64748b";
        ctx.fillText("상단의 [계속하기] 버튼을 누르면 재개됩니다.", canvasLogicalWidth / 2, canvasLogicalHeight / 2 + 35);
        ctx.restore();
      }

      animationFrameId = requestAnimationFrame(render);
    };

    animationFrameId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [gameState, countdown, isMuted, resetBallAndPaddle]);

  return (
    <div className="min-h-screen bg-slate-100/80 text-slate-900 flex flex-col justify-between select-none">
      {/* 상단 네비게이션 헤더 (게임 진행 시에만 깔끔하게 노출) */}
      {gameState !== "INTRO" && (
        <header className="w-full bg-white/90 backdrop-blur-md border-b border-slate-200/80 py-3.5 px-4 sm:px-8 shadow-xs sticky top-0 z-20">
          <div className="max-w-5xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow-md shadow-blue-500/20">
                <Flame className="w-5 h-5 fill-current" />
              </div>
              <div>
                <h1 className="text-xl sm:text-2xl font-black text-blue-600 tracking-tight leading-none">
                  INU 벽돌깨기
                </h1>
                <p className="text-xs font-semibold text-rose-500 mt-1">
                  빨간 벽돌 3개를 찾으세요!
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsMuted(!isMuted)}
                title={isMuted ? "소리 켜기" : "소리 끄기"}
                className="text-slate-600 hover:text-blue-600 hover:bg-blue-50 rounded-full"
              >
                {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
              </Button>

              <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-50 border border-blue-200 text-blue-900 text-xs sm:text-sm font-medium">
                <User className="w-3.5 h-3.5 text-blue-600" />
                <strong>{userName}</strong>
              </span>
            </div>
          </div>
        </header>
      )}

      {/* 메인 콘텐츠 영역 */}
      <main className="flex-1 flex flex-col items-center justify-center p-1 sm:p-4 max-w-5xl w-full mx-auto">
        {gameState === "INTRO" ? (
          /* 첫 화면 (마스코트 횃불이 + 이름 입력 + 게임 시작) */
          <Card className="w-full max-w-md bg-white border border-slate-200/90 shadow-xl rounded-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 mx-3">
            {/* 상단 비주얼 영역 (마스코트 횃불이 배치) */}
            <div className="bg-gradient-to-b from-blue-50 via-sky-50/50 to-white pt-6 pb-2 px-6 flex flex-col items-center border-b border-slate-100">
              <div className="relative w-36 h-36 rounded-2xl overflow-hidden shadow-md border-2 border-white mb-3 bg-white">
                <Image
                  src="/Mascot.jpg"
                  alt="인천대학교 마스코트 횃불이"
                  fill
                  className="object-contain p-1"
                  priority
                />
              </div>
              <h2 className="text-2xl font-black text-blue-600">INU 벽돌깨기</h2>
              <p className="text-xs sm:text-sm font-semibold text-rose-500 mt-0.5">
                빨간 벽돌 3개를 찾으세요!
              </p>
            </div>

            <CardContent className="space-y-5 pt-5 pb-6 px-6">
              {/* 조작법 안내 */}
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center gap-2 text-xs text-slate-600 font-medium">
                <ArrowLeftRight className="w-4 h-4 text-blue-600 shrink-0" />
                <span>PC: 좌우 방향키 (←, →) | 모바일: 화면 좌우 스와이프</span>
              </div>

              {/* 이름 입력 */}
              <div>
                <Input
                  id="playerName"
                  placeholder="이름을 입력하시오"
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && userName.trim()) handleStartGame();
                  }}
                  className="bg-slate-50/50 border-slate-300 text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:ring-1 focus:ring-blue-600 h-11 rounded-xl text-sm"
                  autoFocus
                />
              </div>

              {/* Top 3 명예의 전당 (리더보드) */}
              <div className="p-3.5 rounded-xl bg-gradient-to-br from-blue-50/80 via-slate-50 to-amber-50/50 border border-slate-200">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <Trophy className="w-4 h-4 text-amber-500" />
                    Top 3 명예의 전당
                  </span>
                  {isLoadingLeaderboard && (
                    <span className="text-[10px] text-blue-600 animate-pulse font-medium">
                      불러오는 중...
                    </span>
                  )}
                </div>

                {top3.length > 0 ? (
                  <div className="space-y-1.5">
                    {top3.map((item, idx) => {
                      const medalColors = [
                        "bg-amber-100 text-amber-700 border-amber-300", // 1위 금
                        "bg-slate-200 text-slate-700 border-slate-300", // 2위 은
                        "bg-amber-700/10 text-amber-800 border-amber-600/30", // 3위 동
                      ];
                      const medalBadges = ["🥇", "🥈", "🥉"];

                      return (
                        <div
                          key={idx}
                          className="flex items-center justify-between py-1.5 px-2.5 rounded-lg bg-white/90 border border-slate-200/80 text-xs shadow-2xs"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-sm">{medalBadges[idx] || `${idx + 1}`}</span>
                            <span className="font-bold text-slate-800 max-w-[120px] truncate">
                              {item.name}
                            </span>
                          </div>
                          <div className="flex items-center gap-1 font-mono font-bold text-blue-600 text-xs">
                            <Clock className="w-3 h-3 text-slate-400" />
                            <span>{item.finishtime}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-[11px] text-slate-400 text-center py-2">
                    {isLoadingLeaderboard
                      ? "리더보드 기록을 조회 중입니다..."
                      : "아직 등록된 Top 3 랭킹이 없습니다. 첫 주인공이 되어보세요!"}
                  </p>
                )}
              </div>

              {/* 게임 시작 버튼 */}
              <Button
                onClick={handleStartGame}
                disabled={!userName.trim()}
                className="w-full h-11 text-base font-bold bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-500/25 rounded-xl transition-all"
              >
                <Play className="w-4 h-4 mr-2 fill-current" /> 게임 시작
              </Button>
            </CardContent>
          </Card>
        ) : (
          /* 게임 플레이 화면 (모바일 화면에 꽉 차도록 최적화) */
          <div className="w-full max-w-5xl flex flex-col items-center gap-1.5 flex-1 justify-center px-0.5 sm:px-2">
            {/* 상단 컨트롤 대시보드 (모바일 화면 넘침 방지 및 글자 크기 최적화) */}
            <div className="w-full flex items-center justify-between gap-1 px-2 sm:px-3 py-1 bg-white rounded-xl border border-slate-200 shadow-xs text-[11px] sm:text-xs">
              {/* 생명 */}
              <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
                <span className="text-[10px] sm:text-xs font-semibold text-slate-500 mr-0.5">생명:</span>
                {[...Array(3)].map((_, i) => (
                  <Heart
                    key={i}
                    className={`w-3.5 h-3.5 sm:w-4 sm:h-4 transition-transform ${
                      i < lives
                        ? "text-rose-500 fill-rose-500 scale-100"
                        : "text-slate-300 fill-slate-200 scale-90"
                    }`}
                  />
                ))}
              </div>

              {/* 빨간 벽돌 진행 상황 */}
              <Badge
                variant="outline"
                className="px-1.5 sm:px-2 py-0.5 bg-rose-50 border-rose-300 text-rose-700 flex items-center gap-1 text-[10px] sm:text-xs font-bold h-6 shrink-0"
              >
                <span className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-rose-500 animate-pulse" />
                빨간벽돌: <strong className="text-rose-900 text-[11px] sm:text-xs">{targetDestroyed}</strong>/3
              </Badge>

              {/* 타이머 */}
              <div className="flex items-center gap-0.5 sm:gap-1 font-mono text-[11px] sm:text-xs bg-slate-100 px-1.5 sm:px-2.5 py-0.5 rounded-md border border-slate-200 text-blue-700 h-6 shrink-0">
                <span className="text-[10px] sm:text-[11px] text-slate-500">시간:</span>
                <strong className="text-[11px] sm:text-sm font-bold">{formatTime(elapsedTime)}</strong>
              </div>

              {/* 컨트롤 버튼 */}
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleTogglePause}
                  disabled={gameState === "COUNTDOWN" || gameState === "VICTORY" || gameState === "GAME_OVER"}
                  className="h-6 sm:h-7 px-1.5 sm:px-2 border-slate-300 bg-white hover:bg-slate-100 text-slate-700 text-[10px] sm:text-[11px] font-medium rounded-lg"
                >
                  {gameState === "PAUSED" ? (
                    <>
                      <Play className="w-2.5 h-2.5 sm:w-3 sm:h-3 mr-0.5 fill-current text-emerald-600" /> 계속
                    </>
                  ) : (
                    <>
                      <Pause className="w-2.5 h-2.5 sm:w-3 sm:h-3 mr-0.5 fill-current text-amber-500" /> 정지
                    </>
                  )}
                </Button>

                <Button
                  size="sm"
                  variant="destructive"
                  onClick={handleEndGame}
                  className="h-6 sm:h-7 px-1.5 sm:px-2 bg-rose-600 hover:bg-rose-700 text-white text-[10px] sm:text-[11px] font-medium rounded-lg"
                >
                  <RotateCcw className="w-2.5 h-2.5 sm:w-3 sm:h-3 mr-0.5" /> 종료
                </Button>
              </div>
            </div>

            {/* 캔버스 영역 (화면에 꽉 차는 풀사이즈) */}
            <div className="relative w-full aspect-[4/3] max-w-5xl rounded-xl sm:rounded-2xl overflow-hidden border border-slate-300 shadow-lg bg-white touch-none">
              <canvas
                ref={canvasRef}
                width={800}
                height={600}
                className="w-full h-full block cursor-none"
              />

              {/* 미션 성공 팝업 */}
              {gameState === "VICTORY" && (
                <div className="absolute inset-0 bg-white/95 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center animate-in fade-in zoom-in duration-300">
                  <div className="w-16 h-16 rounded-full bg-gradient-to-tr from-amber-400 to-yellow-200 flex items-center justify-center mb-4 shadow-lg shadow-amber-400/30">
                    <Trophy className="w-8 h-8 text-amber-950" />
                  </div>
                  <h2 className="text-3xl font-black text-blue-600 mb-1">
                    미션 완료! 축하합니다!
                  </h2>
                  <p className="text-slate-600 mb-4 text-sm sm:text-base">
                    <strong>{userName}</strong> 님이 빨간 벽돌 3개를 모두 찾았습니다!
                  </p>
                  <div className="px-5 py-2.5 rounded-xl bg-blue-50 border border-blue-200 mb-4 flex items-center gap-3">
                    <span className="text-slate-600 text-sm font-medium">완료 시간:</span>
                    <span className="text-2xl font-mono font-black text-blue-600">
                      {formatTime(elapsedTime)}
                    </span>
                  </div>

                  {/* Top 3 랭킹 리더보드 (승리 팝업) */}
                  <div className="w-full max-w-xs mb-4 p-3 rounded-xl bg-slate-50 border border-slate-200 text-left">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-bold text-slate-700 flex items-center gap-1">
                        <Trophy className="w-3.5 h-3.5 text-amber-500" /> Top 3 랭킹
                      </span>
                      {isLoadingLeaderboard && (
                        <span className="text-[10px] text-blue-600 animate-pulse">갱신 중...</span>
                      )}
                    </div>
                    {top3.length > 0 ? (
                      <div className="space-y-1">
                        {top3.map((item, idx) => {
                          const medalBadges = ["🥇", "🥈", "🥉"];
                          return (
                            <div
                              key={idx}
                              className="flex items-center justify-between py-1 px-2 rounded bg-white border border-slate-200/80 text-xs"
                            >
                              <div className="flex items-center gap-1.5">
                                <span>{medalBadges[idx] || `${idx + 1}`}</span>
                                <span className="font-semibold text-slate-800 truncate max-w-[95px]">
                                  {item.name}
                                </span>
                              </div>
                              <span className="font-mono text-blue-600 font-bold text-xs">
                                {item.finishtime}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-[11px] text-slate-400 text-center py-1">
                        리더보드를 집계하고 있습니다...
                      </p>
                    )}
                  </div>

                  {/* 구글 시트 전송 상태 알림 */}
                  {GOOGLE_SCRIPT_URL && (
                    <div className="mb-4 text-xs">
                      {isSaving && (
                        <span className="text-blue-600 font-semibold flex items-center gap-1.5 animate-pulse">
                          📊 구글 시트에 기록 저장 중...
                        </span>
                      )}
                      {saveSuccess && (
                        <span className="text-emerald-600 font-bold flex items-center gap-1.5">
                          ✓ 구글 시트에 성공 기록이 저장되었습니다!
                        </span>
                      )}
                    </div>
                  )}
                  <div className="flex gap-3">
                    <Button
                      onClick={handleStartGame}
                      className="bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-md shadow-blue-500/20"
                    >
                      <Play className="w-4 h-4 mr-1.5" /> 다시 도전하기
                    </Button>
                    <Button
                      onClick={handleEndGame}
                      variant="outline"
                      className="border-slate-300 hover:bg-slate-100 text-slate-700 rounded-xl"
                    >
                      이름 화면으로
                    </Button>
                  </div>
                </div>
              )}

              {/* 미션 실패 팝업 (시간 측정 미표시) */}
              {gameState === "GAME_OVER" && (
                <div className="absolute inset-0 bg-white/95 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center animate-in fade-in zoom-in duration-300">
                  <div className="w-16 h-16 rounded-full bg-rose-100 border border-rose-200 flex items-center justify-center mb-4">
                    <Frown className="w-8 h-8 text-rose-600" />
                  </div>
                  <h2 className="text-3xl font-black text-rose-600 mb-2">
                    게임 미션 실패!
                  </h2>
                  <p className="text-slate-600 mb-6 text-sm sm:text-base max-w-sm">
                    생명을 모두 소진하였습니다. 다시 도전해 보세요!
                  </p>
                  <div className="flex gap-3">
                    <Button
                      onClick={handleStartGame}
                      className="bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl shadow-md shadow-rose-600/20"
                    >
                      <RotateCcw className="w-4 h-4 mr-1.5" /> 다시 시도
                    </Button>
                    <Button
                      onClick={handleEndGame}
                      variant="outline"
                      className="border-slate-300 hover:bg-slate-100 text-slate-700 rounded-xl"
                    >
                      처음 화면으로
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {/* 안내 캡션 */}
            <div className="text-xs text-slate-500 flex items-center gap-3">
              <span className="hidden sm:inline">💡 키보드 좌우 방향키 (←, →)로 패들을 부드럽게 조작하세요.</span>
              <span className="sm:hidden">💡 화면을 좌우로 터치 스와이프하여 패들을 이동하세요.</span>
              <span className="flex items-center gap-1 font-medium text-blue-600">
                🎵 배경음악: Hyper Speed Run
              </span>
            </div>
          </div>
        )}
      </main>

      {/* 하단 푸터 (Footer) */}
      <footer className="w-full bg-white/80 border-t border-slate-200 py-3.5 px-4 text-center">
        <p className="text-xs sm:text-sm font-medium text-slate-600">
          미디어커뮤니케이션학과 202500476 정수연
        </p>
      </footer>
    </div>
  );
}
