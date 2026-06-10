"use client";

import { useState, useRef, useEffect } from "react";

export interface CameraCaptureProps {
  onCapture: (blob: Blob) => void;
  onCancel: () => void;
  title: string;
  detail: string;
}

type CameraFacing = "user" | "environment";

export default function CameraCapture({ onCapture, onCancel, title, detail }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [hasCamera, setHasCamera] = useState(true);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraFacing, setCameraFacing] = useState<CameraFacing>("environment"); // rear camera by default
  const [error, setError] = useState<string>("");
  const [isCapturing, setIsCapturing] = useState(false);

  // Initialize camera
  useEffect(() => {
    if (!cameraActive) return;

    const initCamera = async () => {
      try {
        setError("");
        
        // Request camera with preferred facing
        const constraints: MediaStreamConstraints = {
          video: {
            facingMode: cameraFacing,
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        };

        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          // Ensure video plays
          videoRef.current.play().catch(() => {});
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Camera access denied";
        setError(errorMsg);
        setHasCamera(false);
        setCameraActive(false);
      }
    };

    initCamera();

    return () => {
      // Cleanup: stop all tracks
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
    };
  }, [cameraActive, cameraFacing]);

  const startCamera = () => {
    setHasCamera(true);
    setCameraActive(true);
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  const captureFrame = async () => {
    if (!videoRef.current || !canvasRef.current) return;

    try {
      setIsCapturing(true);
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // Set canvas size to match video
      canvas.width = videoRef.current.videoWidth || 1280;
      canvas.height = videoRef.current.videoHeight || 720;

      // Draw current video frame to canvas
      ctx.drawImage(videoRef.current, 0, 0);

      // Convert to blob
      canvas.toBlob((blob) => {
        if (blob) {
          onCapture(blob);
          stopCamera();
        }
        setIsCapturing(false);
      }, "image/jpeg", 0.95);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Capture failed";
      setError(errorMsg);
      setIsCapturing(false);
    }
  };

  const switchCamera = async () => {
    stopCamera();
    setCameraFacing((prev) => (prev === "environment" ? "user" : "environment"));
    // Re-start with new facing
    setTimeout(() => setCameraActive(true), 100);
  };

  const fallbackToFile = () => {
    stopCamera();
    fileInputRef.current?.click();
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onCapture(file);
    }
  };

  // If no camera, show file input
  if (!hasCamera) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
          <div className="bg-red-50 border-b border-red-200 px-6 py-4">
            <p className="font-bold text-slate-900">Camera Not Available</p>
            <p className="text-sm text-red-700 mt-1">{error}</p>
          </div>
          <div className="px-6 py-5 space-y-4">
            <p className="text-sm text-slate-600">
              Camera access is unavailable. Please use file upload instead.
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileInput}
              className="hidden"
            />
            <div className="flex gap-3">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex-1 bg-indigo-600 text-white font-semibold px-4 py-2 rounded-xl hover:bg-indigo-700 transition-colors"
              >
                Choose File
              </button>
              <button
                onClick={onCancel}
                className="flex-1 bg-slate-100 text-slate-600 font-semibold px-4 py-2 rounded-xl hover:bg-slate-200 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Camera active view
  if (cameraActive) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-black">
        {/* Video feed */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          className="flex-1 w-full h-full object-cover"
          style={{ WebkitTransform: cameraFacing === "user" ? "scaleX(-1)" : "scaleX(1)" }}
        />

        {/* Capture overlay */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-64 h-80 border-4 border-yellow-400 rounded-2xl opacity-50" />
        </div>

        {/* Top bar */}
        <div className="absolute top-0 left-0 right-0 bg-gradient-to-b from-black/60 to-transparent px-4 py-4 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-bold text-lg">{title}</p>
              <p className="text-xs text-gray-300">{detail}</p>
            </div>
            <button
              onClick={onCancel}
              className="w-10 h-10 rounded-full bg-red-500/80 hover:bg-red-600 flex items-center justify-center text-white font-bold"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Bottom controls */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-4 py-6 text-white space-y-4">
          {/* Capture button */}
          <div className="flex justify-center">
            <button
              onClick={captureFrame}
              disabled={isCapturing}
              className="w-16 h-16 rounded-full bg-white/30 hover:bg-white/50 border-4 border-white flex items-center justify-center transition-all disabled:opacity-50"
            >
              <div className="w-12 h-12 rounded-full bg-white/60 hover:bg-white" />
            </button>
          </div>

          {/* Action buttons */}
          <div className="flex gap-3 justify-center">
            <button
              onClick={switchCamera}
              className="flex items-center gap-2 bg-white/20 hover:bg-white/30 px-4 py-2 rounded-full text-sm font-semibold transition-colors"
            >
              🔄 Switch Camera
            </button>
            <button
              onClick={fallbackToFile}
              className="flex items-center gap-2 bg-white/20 hover:bg-white/30 px-4 py-2 rounded-full text-sm font-semibold transition-colors"
            >
              📁 Upload File
            </button>
          </div>
        </div>

        {/* Hidden canvas for capture */}
        <canvas ref={canvasRef} className="hidden" />

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileInput}
          className="hidden"
        />
      </div>
    );
  }

  // Initial state - show start button
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="bg-indigo-50 border-b border-indigo-200 px-6 py-4">
          <p className="font-bold text-slate-900">{title}</p>
          <p className="text-sm text-indigo-700 mt-1">{detail}</p>
        </div>
        <div className="px-6 py-8 space-y-4 text-center">
          <div className="text-5xl mb-4">📷</div>
          <p className="text-slate-600 text-sm">
            Position the product in the frame and tap to capture.
          </p>
          <div className="flex gap-3">
            <button
              onClick={startCamera}
              className="flex-1 bg-indigo-600 text-white font-semibold px-4 py-3 rounded-xl hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2"
            >
              📸 Open Camera
            </button>
            <button
              onClick={fallbackToFile}
              className="flex-1 bg-slate-100 text-slate-600 font-semibold px-4 py-3 rounded-xl hover:bg-slate-200 transition-colors"
            >
              📁 File
            </button>
          </div>
          <button
            onClick={onCancel}
            className="w-full text-slate-500 hover:text-slate-700 text-sm font-semibold py-2"
          >
            Cancel
          </button>
        </div>

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileInput}
          className="hidden"
        />
      </div>
    </div>
  );
}
