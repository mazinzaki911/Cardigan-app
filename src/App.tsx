/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { GoogleGenAI } from "@google/genai";
import { 
  Upload, 
  Image as ImageIcon, 
  Layers, 
  CheckCircle2, 
  AlertCircle, 
  Loader2, 
  Plus, 
  X, 
  Sparkles,
  Camera,
  User,
  Settings2,
  Download,
  ExternalLink
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useDropzone } from 'react-dropzone';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Types ---

declare global {
  interface Window {
    aistudio?: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

interface ImageFile {
  id: string;
  file: File;
  preview: string;
  base64: string;
}

interface GenerationResult {
  targetId: string;
  images: string[];
  status: 'pending' | 'processing' | 'completed' | 'error';
  error?: string;
  progress: number; // 0 to 4
}

// --- Constants ---

const MODEL_NAME = "gemini-3-pro-image-preview";
const SYSTEM_PROMPT = `You are a world-class commercial fashion photographer. 
TASK: Generate a professional 4K fashion photograph.

STRICT REQUIREMENTS:
1. BACKGROUND & SETTING: You MUST use the exact same background, environment, and lighting as shown in the provided "SCENE REFERENCE" image. The setting must remain perfectly consistent across all generations.
2. POSE: You MUST replicate the pose and camera angle from the "SCENE REFERENCE" image.
3. TARGET PRODUCT: The model MUST be wearing the "TARGET CARDIGAN". Replicate its color, knit pattern, texture, and silhouette with 100% accuracy.
4. MODEL FACE VARIETY: For each generation, use a DIFFERENT, unique, and realistic woman's face. Ensure the faces are diverse and professional. The face should look natural and seamlessly integrated into the scene.
5. QUALITY: Output must be 4K, sharp, professional editorial quality.`;

// --- Components ---

export default function App() {
  const [apiKeySelected, setApiKeySelected] = useState<boolean>(false);
  const [sceneReferences, setSceneReferences] = useState<ImageFile[]>([]);
  const [targetProducts, setTargetProducts] = useState<ImageFile[]>([]);
  const [results, setResults] = useState<GenerationResult[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentProcessingIndex, setCurrentProcessingIndex] = useState(-1);

  useEffect(() => {
    const checkKey = async () => {
      if (window.aistudio?.hasSelectedApiKey) {
        const hasKey = await window.aistudio.hasSelectedApiKey();
        setApiKeySelected(hasKey);
      }
    };
    checkKey();
  }, []);

  const handleSelectKey = async () => {
    if (window.aistudio?.openSelectKey) {
      await window.aistudio.openSelectKey();
      setApiKeySelected(true);
    }
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const base64String = (reader.result as string).split(',')[1];
        resolve(base64String);
      };
      reader.onerror = error => reject(error);
    });
  };

  const onDropScene = useCallback(async (acceptedFiles: File[]) => {
    const newFiles = await Promise.all(acceptedFiles.map(async file => ({
      id: Math.random().toString(36).substring(7),
      file,
      preview: URL.createObjectURL(file),
      base64: await fileToBase64(file)
    })));
    setSceneReferences(prev => [...prev, ...newFiles]);
  }, []);

  const onDropTarget = useCallback(async (acceptedFiles: File[]) => {
    const newFiles = await Promise.all(acceptedFiles.map(async file => ({
      id: Math.random().toString(36).substring(7),
      file,
      preview: URL.createObjectURL(file),
      base64: await fileToBase64(file)
    })));
    setTargetProducts(prev => [...prev, ...newFiles]);
  }, []);

  const removeScene = (id: string) => setSceneReferences(prev => prev.filter(img => img.id !== id));
  const removeTarget = (id: string) => setTargetProducts(prev => prev.filter(img => img.id !== id));

  const generateForTarget = async (target: ImageFile, onProgress: (count: number) => void) => {
    const key = process.env.API_KEY || process.env.GEMINI_API_KEY;
    if (!key) throw new Error("API Key not found.");
    
    const ai = new GoogleGenAI({ apiKey: key });
    const generatedImages: string[] = [];

    for (let i = 0; i < 4; i++) {
      const sceneRef = sceneReferences[i % sceneReferences.length];
      if (!sceneRef) continue;

      try {
        const parts: any[] = [
          { text: SYSTEM_PROMPT },
          { text: `SHOT #${i + 1}: Use a unique model face for this shot.` },
          { text: "SCENE REFERENCE (Background & Pose):" },
          { inlineData: { data: sceneRef.base64, mimeType: sceneRef.file.type } },
          { text: "TARGET CARDIGAN (Garment to feature):" },
          { inlineData: { data: target.base64, mimeType: target.file.type } },
          { text: "Generate the 4K photo now with a unique model face." }
        ];

        const response = await ai.models.generateContent({
          model: MODEL_NAME,
          contents: [{ role: 'user', parts }],
          config: {
            imageConfig: {
              aspectRatio: "3:4",
              imageSize: "1K"
            }
          }
        });

        if (response.candidates?.[0]?.content?.parts) {
          for (const part of response.candidates[0].content.parts) {
            if (part.inlineData) {
              generatedImages.push(`data:image/png;base64,${part.inlineData.data}`);
              onProgress(generatedImages.length);
            }
          }
        }
      } catch (error: any) {
        console.error(`Error generating image ${i + 1}:`, error);
        throw error;
      }
    }

    return generatedImages;
  };

  const startBulkGeneration = async () => {
    if (targetProducts.length === 0 || sceneReferences.length === 0) return;
    setIsProcessing(true);
    setResults([]);

    const initialResults: GenerationResult[] = targetProducts.map(img => ({
      targetId: img.id,
      images: [],
      status: 'pending',
      progress: 0
    }));
    setResults(initialResults);

    for (let i = 0; i < targetProducts.length; i++) {
      setCurrentProcessingIndex(i);
      const target = targetProducts[i];
      
      setResults(prev => prev.map((res, idx) => 
        idx === i ? { ...res, status: 'processing' } : res
      ));

      try {
        const images = await generateForTarget(target, (count) => {
          setResults(prev => prev.map((res, idx) => 
            idx === i ? { ...res, progress: count } : res
          ));
        });
        setResults(prev => prev.map((res, idx) => 
          idx === i ? { ...res, images, status: 'completed', progress: 4 } : res
        ));
      } catch (error: any) {
        setResults(prev => prev.map((res, idx) => 
          idx === i ? { ...res, status: 'error', error: error.message } : res
        ));
      }
    }

    setIsProcessing(false);
    setCurrentProcessingIndex(-1);
  };

  const downloadAll = (images: string[], productName: string) => {
    images.forEach((url, i) => {
      const link = document.createElement('a');
      link.href = url;
      link.download = `${productName}-shot-${i + 1}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    });
  };

  const { getRootProps: getSceneProps, getInputProps: getSceneInput, isDragActive: isSceneActive } = useDropzone({
    onDrop: onDropScene,
    accept: { 'image/*': [] },
    multiple: true
  } as any);

  const { getRootProps: getTargetProps, getInputProps: getTargetInput, isDragActive: isTargetActive } = useDropzone({
    onDrop: onDropTarget,
    accept: { 'image/*': [] },
    multiple: true
  } as any);

  if (!apiKeySelected) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#fdfcfb] p-6">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full glass p-8 rounded-3xl text-center space-y-6"
        >
          <div className="w-16 h-16 bg-zinc-900 rounded-2xl flex items-center justify-center mx-auto shadow-lg">
            <Sparkles className="text-white w-8 h-8" />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-serif font-bold">Cardigan Studio Pro</h1>
            <p className="text-zinc-500 text-sm">
              Connect your API key to start generating consistent fashion photography.
            </p>
          </div>
          <button
            onClick={handleSelectKey}
            className="w-full py-4 bg-zinc-900 text-white rounded-xl font-medium hover:bg-zinc-800 transition-all flex items-center justify-center gap-2 group"
          >
            Select API Key
            <ExternalLink className="w-4 h-4 opacity-50 group-hover:opacity-100 transition-opacity" />
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-20">
      <header className="sticky top-0 z-50 glass border-b border-zinc-100 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-zinc-900 rounded-xl flex items-center justify-center">
              <Camera className="text-white w-5 h-5" />
            </div>
            <div>
              <h1 className="font-serif font-bold text-lg leading-tight">Cardigan Studio</h1>
              <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-medium">Consistency Engine</p>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            {isProcessing && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-zinc-50 rounded-full border border-zinc-100">
                <Loader2 className="w-3 h-3 animate-spin text-zinc-500" />
                <span className="text-xs font-medium text-zinc-600">
                  Processing {currentProcessingIndex + 1} of {targetProducts.length}
                </span>
              </div>
            )}
            <button
              onClick={startBulkGeneration}
              disabled={isProcessing || targetProducts.length === 0 || sceneReferences.length === 0}
              className={cn(
                "px-6 py-2.5 rounded-full font-medium transition-all flex items-center gap-2",
                isProcessing || targetProducts.length === 0 || sceneReferences.length === 0
                  ? "bg-zinc-100 text-zinc-400 cursor-not-allowed"
                  : "bg-zinc-900 text-white hover:bg-zinc-800 shadow-lg shadow-zinc-200"
              )}
            >
              {isProcessing ? "Generating..." : "Generate Bulk Catalog"}
              {!isProcessing && <Sparkles className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 pt-8 space-y-12">
        {/* Setup Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* 1. Scenes */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ImageIcon className="w-4 h-4 text-zinc-400" />
                <h2 className="font-medium text-[10px] text-zinc-500 uppercase tracking-widest">1. Studio Scenes (Location & Pose)</h2>
              </div>
              <span className="text-[10px] font-bold text-zinc-400">{sceneReferences.length}</span>
            </div>
            <div {...getSceneProps()} className={cn("border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-colors", isSceneActive ? "bg-zinc-50 border-zinc-900" : "border-zinc-100 hover:border-zinc-200")}>
              <input {...getSceneInput()} />
              <Camera className="w-6 h-6 text-zinc-300 mx-auto mb-3" />
              <p className="text-sm font-medium">Drop pose/background references</p>
              <p className="text-xs text-zinc-400 mt-1">These define the environment and model pose</p>
            </div>
            <div className="grid grid-cols-4 sm:grid-cols-6 gap-3">
              {sceneReferences.map(img => (
                <div key={img.id} className="relative aspect-square rounded-xl overflow-hidden group border border-zinc-100">
                  <img src={img.preview} className="w-full h-full object-cover" />
                  <button onClick={() => removeScene(img.id)} className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white transition-opacity">
                    <X className="w-5 h-5" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* 2. Products */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-zinc-400" />
                <h2 className="font-medium text-[10px] text-zinc-500 uppercase tracking-widest">2. Target Cardigans</h2>
              </div>
              <span className="text-[10px] font-bold text-zinc-400">{targetProducts.length}</span>
            </div>
            <div {...getTargetProps()} className={cn("border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-colors", isTargetActive ? "bg-zinc-50 border-zinc-900" : "border-zinc-100 hover:border-zinc-200")}>
              <input {...getTargetInput()} />
              <Plus className="w-6 h-6 text-zinc-300 mx-auto mb-3" />
              <p className="text-sm font-medium">Drop product photos</p>
              <p className="text-xs text-zinc-400 mt-1">Upload multiple for bulk catalog generation</p>
            </div>
            <div className="grid grid-cols-4 sm:grid-cols-6 gap-3">
              {targetProducts.map(img => (
                <div key={img.id} className="relative aspect-square rounded-xl overflow-hidden group border border-zinc-100">
                  <img src={img.preview} className="w-full h-full object-cover" />
                  <button onClick={() => removeTarget(img.id)} className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white transition-opacity">
                    <X className="w-5 h-5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Results */}
        {results.length > 0 && (
          <div className="space-y-12">
            <div className="flex items-center gap-2 border-b border-zinc-100 pb-4">
              <Sparkles className="w-5 h-5 text-zinc-900" />
              <h2 className="font-serif font-bold text-xl">Generated Catalog</h2>
            </div>
            
            {results.map((result, idx) => {
              const targetImg = targetProducts.find(t => t.id === result.targetId);
              return (
                <div key={result.targetId} className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-16 rounded-lg bg-zinc-50 overflow-hidden border border-zinc-100 shadow-sm">
                        <img src={targetImg?.preview} className="w-full h-full object-cover" />
                      </div>
                      <div>
                        <h3 className="font-serif font-bold text-lg">Product Batch #{idx + 1}</h3>
                        <div className="flex items-center gap-2">
                          {result.status === 'processing' && (
                            <span className="flex items-center gap-1.5 text-xs text-blue-600 font-medium">
                              <Loader2 className="w-3 h-3 animate-spin" />
                              Generating: {result.progress}/4 shots...
                            </span>
                          )}
                          {result.status === 'completed' && (
                            <span className="flex items-center gap-1.5 text-xs text-emerald-600 font-medium">
                              <CheckCircle2 className="w-3 h-3" />
                              Completed
                            </span>
                          )}
                          {result.status === 'error' && (
                            <span className="flex items-center gap-1.5 text-xs text-red-600 font-medium">
                              <AlertCircle className="w-3 h-3" />
                              {result.error}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {result.status === 'completed' && (
                      <button 
                        onClick={() => downloadAll(result.images, `product-${idx + 1}`)}
                        className="flex items-center gap-2 px-4 py-2 bg-zinc-50 hover:bg-zinc-100 text-zinc-600 text-xs font-bold rounded-full border border-zinc-200 transition-colors"
                      >
                        <Download className="w-3 h-3" />
                        Download All
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
                    {result.status === 'processing' && Array.from({ length: 4 }).map((_, i) => (
                      <div key={i} className="aspect-[3/4] bg-zinc-50 rounded-3xl animate-pulse flex items-center justify-center border border-zinc-100">
                        <ImageIcon className="w-8 h-8 text-zinc-100" />
                      </div>
                    ))}
                    
                    {result.images.map((url, i) => (
                      <motion.div
                        key={i}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.1 }}
                        className="group relative aspect-[3/4] rounded-3xl overflow-hidden bg-zinc-100 card-shadow border border-zinc-100"
                      >
                        <img src={url} className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-3">
                          <a href={url} download={`catalog-${idx}-${i}.png`} className="p-4 bg-white text-zinc-900 rounded-full hover:scale-110 transition-transform shadow-xl">
                            <Download className="w-6 h-6" />
                          </a>
                          <span className="text-[10px] text-white font-bold tracking-widest uppercase">4K High Res</span>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      <footer className="fixed bottom-0 left-0 right-0 glass border-t border-zinc-100 px-6 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between text-[10px] text-zinc-400 font-bold uppercase tracking-widest">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1"><Settings2 className="w-3 h-3" /> Consistency Engine v3</span>
            <span>Diverse Faces Mode</span>
          </div>
          <div className="flex items-center gap-1"><Sparkles className="w-3 h-3" /> Powered by Gemini 3 Pro</div>
        </div>
      </footer>
    </div>
  );
}
