import React, { useState, useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Type, Schema } from "@google/genai";
import { Upload, FileText, Download, Trash2, X, Check, Loader2, Image as ImageIcon, Clipboard, Plus, Eye, ZoomIn, ZoomOut, Maximize2, ArrowUp, ArrowDown, Shuffle, Settings, User, Key, ArrowLeft, Info, EyeOff, Calculator, FlaskConical, Languages } from 'lucide-react';

// Declare mammoth for TypeScript (loaded via script tag)
declare const mammoth: any;

// --- CONFIGURATION ---
// ⚠️ QUAN TRỌNG: Key mặc định của chủ sở hữu web.
// Hệ thống sẽ ưu tiên: Key người dùng nhập > Key này > Báo lỗi.
// Bạn có thể dán trực tiếp chuỗi Key vào đây, ví dụ: "AIzaSy..."
const DEFAULT_OWNER_KEY = process.env.API_KEY || ""; 

// --- Types ---

interface ImageItem {
  id: string;
  url: string;
  file: File;
  base64: string;
}

// Structure for Part 1 (Multiple Choice) & Part 3 (Short Answer)
interface SimpleAnswer {
  q: number | string; 
  a: string; 
}

// Structure for Part 2 (True/False Group)
interface GroupAnswer {
  q: number;
  a: string; // Đ/S for option a
  b: string; // Đ/S for option b
  c: string; // Đ/S for option c
  d: string; // Đ/S for option d
}

// Represents answers for ONE specific Exam Code (Mã đề)
interface ExamResult {
  code: string; // e.g., "201", "202"
  part1?: SimpleAnswer[];
  part2?: GroupAnswer[];
  part3?: SimpleAnswer[];
}

interface SubjectState {
  id: string;
  name: string;
  type: 'english' | 'math' | 'science'; // To determine prompt logic
  color: string;
  imageIds: string[];
  results: ExamResult[] | null; // Changed from single object to Array
  isLoading: boolean;
  error: string | null;
}

interface DocFile {
  id: string;
  name: string;
  file: File;
  content: string; // Base64 for PDF, Text for DOCX/TXT
  type: 'pdf' | 'text';
}

interface AnalysisResult {
  examName: string;
  mapping: (number | null)[]; // Index 0 = Q1 of Ref Exam. Value = The question number in this exam.
}

// --- Constants ---

const SUBJECTS_CONFIG = [
  { id: 'math', name: 'Toán Học', type: 'math', color: 'var(--subject-math)' },
  { id: 'physics', name: 'Vật Lý', type: 'science', color: 'var(--subject-phys)' },
  { id: 'chemistry', name: 'Hóa Học', type: 'science', color: 'var(--subject-chem)' },
  { id: 'english', name: 'Tiếng Anh', type: 'english', color: 'var(--subject-eng)' },
  { id: 'biology', name: 'Sinh Học', type: 'science', color: 'var(--subject-bio)' },
];

const TABLE_COLORS = ['#ffff00', '#ff99cc', '#ccffcc', '#00ccff', '#e0e0e0']; // Yellow, Pink, Green, Blue

// --- Helper Functions ---

const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const result = reader.result as string;
      const base64Data = result.split(',')[1]; 
      resolve(base64Data);
    };
    reader.onerror = error => reject(error);
  });
};

const extractTextFromDocx = async (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const arrayBuffer = event.target?.result;
      if (typeof mammoth !== 'undefined') {
        mammoth.extractRawText({ arrayBuffer: arrayBuffer })
          .then((result: any) => resolve(result.value))
          .catch((err: any) => reject(err));
      } else {
        reject("Mammoth library not loaded");
      }
    };
    reader.readAsArrayBuffer(file);
  });
};

const flattenExamData = (exam: ExamResult, subjectType: string): string[] => {
  const items: string[] = [];
  if (exam.part1) {
    const sorted = [...exam.part1].sort((a,b) => parseInt(String(a.q)) - parseInt(String(b.q)));
    sorted.forEach(p1 => items.push(`${p1.q}.${p1.a}`));
  }
  if (subjectType === 'math') {
    for (let i = 0; i < 6; i++) items.push("");
  }
  if (exam.part2) {
    const sorted = [...exam.part2].sort((a,b) => a.q - b.q);
    sorted.forEach(p2 => {
      items.push(`${p2.q}A.${p2.a}`);
      items.push(`${p2.q}B.${p2.b}`);
      items.push(`${p2.q}C.${p2.c}`);
      items.push(`${p2.q}D.${p2.d}`);
    });
  }
  if (exam.part3) {
    const sorted = [...exam.part3].sort((a,b) => parseInt(String(a.q)) - parseInt(String(b.q)));
    sorted.forEach(p3 => items.push(`${p3.a}`));
  }
  return items;
};

// --- Main App Component ---

const App = () => {
  const [activeTab, setActiveTab] = useState<'answers' | 'analysis'>('answers');
  
  // --- STATE FOR ANSWERS TAB ---
  const [images, setImages] = useState<Record<string, ImageItem>>({});
  const [subjects, setSubjects] = useState<SubjectState[]>(
    SUBJECTS_CONFIG.map(s => ({
      id: s.id,
      name: s.name,
      type: s.type as 'english' | 'math' | 'science',
      color: s.color,
      imageIds: [],
      results: null,
      isLoading: false,
      error: null
    }))
  );
  const [inspectImageId, setInspectImageId] = useState<string | null>(null);
  const [inspectSubjectId, setInspectSubjectId] = useState<string | null>(null);
  const [zoomLevel, setZoomLevel] = useState(1);

  // --- STATE FOR ANALYSIS TAB ---
  const [docFiles, setDocFiles] = useState<DocFile[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult[] | null>(null);
  const [analysisType, setAnalysisType] = useState<'math' | 'science' | 'english' | null>(null);


  // --- STATE FOR SETTINGS ---
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'author' | 'config'>('author');
  const [userApiKey, setUserApiKey] = useState(() => {
    return localStorage.getItem('gemini_api_key') || '';
  });
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    localStorage.setItem('gemini_api_key', userApiKey);
  }, [userApiKey]);

  // Helper to safely get the API Key
  const getAI = () => {
    // Priority 1: User's personal key
    let key = userApiKey.trim();
    
    // Priority 2: System Default Key (Hardcoded or Env)
    if (!key) {
        key = DEFAULT_OWNER_KEY;
    }

    if (!key) {
      throw new Error("Vui lòng nhập Google Gemini API Key trong phần Cài đặt.");
    }
    return new GoogleGenAI({ apiKey: key });
  };

  // Helper: Try models in sequence for robustness
  const generateWithFallback = async (ai: GoogleGenAI, params: any) => {
    // Priority: 1. Experimental 2.0 Pro (Best), 2. Stable 1.5 Pro (Reliable)
    const models = ['gemini-2.0-pro-exp-02-05', 'gemini-1.5-pro'];
    
    let lastError;
    for (const model of models) {
      try {
        console.log(`Attempting with model: ${model}`);
        const response = await ai.models.generateContent({
          ...params,
          model: model,
        });
        return response; // Success
      } catch (e: any) {
        console.warn(`Model ${model} failed:`, e);
        lastError = e;
        // Continue to next model
      }
    }
    throw lastError; // All failed
  };

  // --------------------------------------------------------------------------
  //                               ANSWERS TAB LOGIC
  // --------------------------------------------------------------------------

  const addFilesToSubject = async (files: FileList | File[], subjectId: string) => {
    const newImages: Record<string, ImageItem> = {};
    const newImageIds: string[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file.type.startsWith('image/') && file.type !== 'application/pdf') continue;
      const id = `doc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const url = URL.createObjectURL(file);
      try {
         const base64 = await fileToBase64(file);
         newImages[id] = { id, url, file, base64 };
         newImageIds.push(id);
      } catch (e) {
        console.error("Error reading file", e);
      }
    }

    if (newImageIds.length > 0) {
      setImages(prev => ({ ...prev, ...newImages }));
      setSubjects(prev => prev.map(s => {
        if (s.id === subjectId) {
          return { ...s, imageIds: [...s.imageIds, ...newImageIds], results: null }; 
        }
        return s;
      }));
    }
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>, subjectId: string) => {
    if (event.target.files) {
      addFilesToSubject(event.target.files, subjectId);
      event.target.value = '';
    }
  };

  const handleDrop = (e: React.DragEvent, subjectId: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      addFilesToSubject(e.dataTransfer.files, subjectId);
    }
  };

  const handlePaste = (e: React.ClipboardEvent, subjectId: string) => {
    if (e.clipboardData.files && e.clipboardData.files.length > 0) {
      e.preventDefault();
      addFilesToSubject(e.clipboardData.files, subjectId);
    }
  };

  const removeImage = (imageId: string, subjectId: string) => {
    if (images[imageId]) URL.revokeObjectURL(images[imageId].url);
    const newImages = { ...images };
    delete newImages[imageId];
    setImages(newImages);
    setSubjects(prev => prev.map(s => {
      if (s.id === subjectId) {
        return { ...s, imageIds: s.imageIds.filter(id => id !== imageId) };
      }
      return s;
    }));
    if (inspectImageId === imageId) {
      setInspectImageId(null);
      setInspectSubjectId(null);
    }
  };

  const getSystemInstruction = (subject: SubjectState) => {
    const role = "Bạn là chuyên gia xử lý dữ liệu (OCR Expert). Nhiệm vụ của bạn là trích xuất dữ liệu từ bảng đáp án với độ chính xác 100%.";
    
    let structureInfo = "";
    if (subject.type === 'english') {
      structureInfo = `
      CẤU TRÚC ĐỀ TIẾNG ANH:
      - Chỉ có 1 Phần (Trắc nghiệm 4 lựa chọn).
      - Các câu hỏi được đánh số liên tục từ 1 đến 40 (hoặc 50 tùy đề).
      - Mỗi câu chỉ có 1 đáp án đúng (A, B, C, hoặc D).
      `;
    } else {
      const p1Count = subject.type === 'math' ? 12 : 18;
      structureInfo = `
      CẤU TRÚC ĐỀ MỚI 2025 (QUAN TRỌNG):
      Đề thi gồm 3 PHẦN RIÊNG BIỆT. Hãy nhận diện chính xác từng phần:
      1. PHẦN 1 (Trắc nghiệm nhiều lựa chọn):
         - ${subject.name === 'Toán Học' ? '12' : '18'} câu đầu tiên.
         - Đáp án là 1 ký tự: A, B, C, hoặc D.
      2. PHẦN 2 (Trắc nghiệm Đúng/Sai):
         - Gồm 4 câu hỏi nhóm.
         - Mỗi câu nhóm có 4 ý nhỏ (a, b, c, d).
         - Bắt buộc phải trích xuất đủ 4 ý cho mỗi câu nhóm.
         - Đáp án thường là "Đ" (Đúng) hoặc "S" (Sai). Đôi khi ký hiệu là T/F.
      3. PHẦN 3 (Trả lời ngắn):
         - Gồm 6 câu hỏi cuối.
         - Đáp án là số hoặc chuỗi ngắn.
      `;
    }

    return `${role}
    ${structureInfo}

    QUY TRÌNH XỬ LÝ CAO CẤP (BẮT BUỘC):
    1. SCAN TOÀN BỘ: Tìm tất cả các vùng chứa bảng đáp án (Grid Table).
    2. XÁC ĐỊNH MÃ ĐỀ: Nhóm dữ liệu theo từng Mã Đề (Exam Codes) riêng biệt.
    3. ĐỌC DỮ LIỆU TỪNG DÒNG (ROW-BY-ROW): Đọc kỹ lưỡng từng ô trong bảng. Không được bỏ sót hoặc đoán mò. Nếu ảnh mờ, hãy cố gắng suy luận dựa trên cấu trúc hình học của bảng.
    4. KIỂM TRA LOGIC: 
       - Phần 2 phải có đủ a, b, c, d. 
       - Số lượng câu hỏi phải khớp với cấu trúc đề đã mô tả ở trên.
    `;
  };

  const getSchema = (subject: SubjectState): Schema => {
    const simpleItem = { type: Type.OBJECT, properties: { q: { type: Type.STRING }, a: { type: Type.STRING } }, required: ["q", "a"] };
    const groupItem = { type: Type.OBJECT, properties: { q: { type: Type.INTEGER }, a: { type: Type.STRING }, b: { type: Type.STRING }, c: { type: Type.STRING }, d: { type: Type.STRING } }, required: ["q", "a", "b", "c", "d"] };
    const examCodeProperties: any = { code: { type: Type.STRING }, part1: { type: Type.ARRAY, items: simpleItem } };
    if (subject.type !== 'english') {
      examCodeProperties.part2 = { type: Type.ARRAY, items: groupItem };
      examCodeProperties.part3 = { type: Type.ARRAY, items: simpleItem };
    }
    return { type: Type.ARRAY, items: { type: Type.OBJECT, properties: examCodeProperties, required: subject.type === 'english' ? ["code", "part1"] : ["code", "part1", "part2", "part3"] } };
  };

  const analyzeSubject = async (subjectIndex: number) => {
    const subject = subjects[subjectIndex];
    if (subject.imageIds.length === 0) return;
    
    // Check Key presence locally first
    try {
        getAI();
    } catch (e: any) {
        alert(e.message);
        setShowSettings(true);
        setSettingsTab('config');
        return;
    }

    setSubjects(prev => prev.map((s, i) => i === subjectIndex ? { ...s, isLoading: true, error: null } : s));
    try {
      const ai = getAI();
      const parts = [];
      
      // Add images first
      for (const imgId of subject.imageIds) {
        const imgItem = images[imgId];
        parts.push({ inlineData: { mimeType: imgItem.file.type || 'image/jpeg', data: imgItem.base64 } });
      }

      // Add a specific prompt text to trigger the analysis
      parts.push({ text: "Hãy phân tích hình ảnh và trích xuất bảng đáp án chính xác tuyệt đối theo yêu cầu hệ thống." });

      // USING FALLBACK STRATEGY
      const response = await generateWithFallback(ai, {
        contents: { parts },
        config: { 
          responseMimeType: 'application/json', 
          responseSchema: getSchema(subject),
          systemInstruction: getSystemInstruction(subject),
        }
      });

      let results: ExamResult[] = [];
      if (response.text) {
          const parsed = JSON.parse(response.text);
          results = Array.isArray(parsed) ? parsed : [parsed];
          results.forEach(res => {
            if (res.part1) res.part1.sort((a,b) => parseInt(String(a.q)) - parseInt(String(b.q)));
            if (res.part2) res.part2.sort((a,b) => a.q - b.q);
            if (res.part3) res.part3.sort((a,b) => parseInt(String(a.q)) - parseInt(String(b.q)));
          });
          results.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
      }
      setSubjects(prev => prev.map((s, i) => i === subjectIndex ? { ...s, isLoading: false, results } : s));
    } catch (error: any) {
      console.error("AI Error:", error);
      let msg = "Lỗi khi phân tích. ";
      if (error.message && error.message.includes('429')) msg += "Hệ thống đang quá tải (Rate Limit). Vui lòng nhập API Key riêng trong Cài Đặt.";
      else if (error.message && error.message.includes('404')) msg += "Model không phản hồi. Vui lòng thử lại sau.";
      else msg += "Vui lòng thử lại hoặc kiểm tra API Key.";
      
      setSubjects(prev => prev.map((s, i) => i === subjectIndex ? { ...s, isLoading: false, error: msg } : s));
    }
  };

  const analyzeAll = () => {
    subjects.forEach((s, i) => { if (s.imageIds.length > 0 && !s.results) analyzeSubject(i); });
  };

  const downloadWord = (subject: SubjectState) => {
    if (!subject.results || subject.results.length === 0) return;
    let htmlBody = `<h1 style="text-align:center; color:#1e3a8a; font-family:'Times New Roman', serif;">ĐÁP ÁN MÔN: ${subject.name.toUpperCase()}</h1>`;
    const createUnifiedTable = (exam: ExamResult) => {
      const flatData = flattenExamData(exam, subject.type);
      if (flatData.length === 0) return '';
      const columns = 10;
      let tableRows = '';
      for (let i = 0; i < flatData.length; i += columns) {
        const chunk = flatData.slice(i, i + columns);
        let cells = '';
        chunk.forEach(item => cells += `<td style="border:1px solid black; padding:8px 2px; text-align:center; font-family:'Times New Roman'; font-size:11pt; font-weight:bold;">${item}</td>`);
        for (let j = chunk.length; j < columns; j++) cells += `<td style="border:1px solid black; padding:8px 2px;"></td>`;
        tableRows += `<tr>${cells}</tr>`;
      }
      return `<div style="margin-top: 20px;"><h3 style="text-align:center; font-family:'Times New Roman'; margin-bottom:10px;">BẢNG ĐÁP ÁN MÃ ĐỀ ${exam.code}</h3><table style="width:100%; border-collapse:collapse; border:1px solid black; table-layout: fixed;">${tableRows}</table></div>`;
    };
    subject.results.forEach(exam => htmlBody += createUnifiedTable(exam));
    const fullHtml = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word'><head><meta charset="utf-8"><title>${subject.name}</title></head><body style="font-family:'Times New Roman',serif;">${htmlBody}</body></html>`;
    const blob = new Blob(['\ufeff', fullHtml], { type: 'application/msword' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `Dap_An_${subject.name}_Full.doc`;
    link.click();
  };

  // --------------------------------------------------------------------------
  //                           ANALYSIS TAB LOGIC
  // --------------------------------------------------------------------------

  const handleDocUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    
    // Clear previous results to avoid mismatch errors
    setAnalysisResult(null);

    const newFiles: DocFile[] = [];
    for (let i = 0; i < e.target.files.length; i++) {
      const file = e.target.files[i];
      const id = `file_${Date.now()}_${i}`;
      let content = "";
      let type: 'pdf' | 'text' = 'text';

      if (file.type === "application/pdf") {
        content = await fileToBase64(file);
        type = 'pdf';
      } else if (file.name.endsWith(".docx") || file.name.endsWith(".doc")) {
        try {
          content = await extractTextFromDocx(file);
        } catch (err) {
          console.error("Error reading DOCX", err);
          content = "Error reading docx content.";
        }
      } else {
        // Assume text file
         const reader = new FileReader();
         content = await new Promise((resolve) => {
           reader.onload = (e) => resolve(e.target?.result as string);
           reader.readAsText(file);
         });
      }

      newFiles.push({ id, name: file.name, file, content, type });
    }

    setDocFiles(prev => {
      const combined = [...prev, ...newFiles];
      // Auto sort by name initially
      return combined.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    });
    e.target.value = '';
  };

  const removeDocFile = (id: string) => {
    setDocFiles(prev => prev.filter(f => f.id !== id));
    setAnalysisResult(null); // Clear result when files change
  };

  const moveDocFile = (index: number, direction: 'up' | 'down') => {
    const newFiles = [...docFiles];
    if (direction === 'up' && index > 0) {
      [newFiles[index], newFiles[index - 1]] = [newFiles[index - 1], newFiles[index]];
    } else if (direction === 'down' && index < newFiles.length - 1) {
      [newFiles[index], newFiles[index + 1]] = [newFiles[index + 1], newFiles[index]];
    }
    setDocFiles(newFiles);
    setAnalysisResult(null); // Clear result when order changes
  };

  const compareExams = async (type: 'math' | 'science' | 'english') => {
    if (docFiles.length < 2) return;
    
    // Check Key
    try {
        getAI();
    } catch (e: any) {
        alert(e.message);
        setShowSettings(true);
        setSettingsTab('config');
        return;
    }

    setIsAnalyzing(true);
    setAnalysisType(type);
    setAnalysisResult(null);

    try {
      const ai = getAI();
      const parts = [];

      let specificPrompt = "";
      if (type === 'english') {
          specificPrompt = `
          Cấu trúc đề Tiếng Anh:
          - Gồm 40 câu trắc nghiệm thông thường (Câu 1 đến Câu 40).
          - Tổng số câu cần map: 40.
          `;
      } else if (type === 'math') {
          specificPrompt = `
          Cấu trúc đề Toán (Form mới):
          - Đề thi gốc gồm 3 phần.
          - Quy đổi toàn bộ thành danh sách các câu hỏi đơn lẻ (flattened index) theo thứ tự từ 1 đến 34 như sau:
            + Phần 1 (Câu 1 đến 12): Giữ nguyên thứ tự là câu 1 -> 12.
            + Phần 2 (Câu 13 đến 16): Mỗi câu có 4 ý a,b,c,d. LƯU Ý: Bỏ qua nội dung câu dẫn (stem), chỉ lấy nội dung của từng ý a, b, c, d để so sánh. Tách mỗi ý thành một câu hỏi riêng biệt:
              * Câu 13a -> Câu 13
              * Câu 13b -> Câu 14
              * Câu 13c -> Câu 15
              * Câu 13d -> Câu 16
              * Câu 14a -> Câu 17
              * ... tiếp tục cho đến Câu 16d -> Câu 28.
              (Tóm lại: Phần 2 tương ứng với các câu từ 13 đến 28).
            + Phần 3 (Câu 1 đến 6 - điền đáp án): Coi tiếp là các câu từ 29 đến 34.
              * Phần 3 Câu 1 -> Câu 29
              * Phần 3 Câu 2 -> Câu 30
              * ...
              * Phần 3 Câu 6 -> Câu 34.
          - Tổng số câu cần map: 34.
          `;
      } else if (type === 'science') {
          specificPrompt = `
          Cấu trúc đề Lý / Hóa / Sinh (Form mới):
          - Đề thi gốc gồm 3 phần.
          - Quy đổi toàn bộ thành danh sách các câu hỏi đơn lẻ (flattened index) theo thứ tự từ 1 đến 40 như sau:
            + Phần 1 (Câu 1 đến 18): Giữ nguyên thứ tự là câu 1 -> 18.
            + Phần 2 (Câu 19 đến 22): Mỗi câu có 4 ý a,b,c,d. LƯU Ý: Bỏ qua nội dung câu dẫn (stem), chỉ lấy nội dung của từng ý a, b, c, d để so sánh. Tách mỗi ý thành một câu hỏi riêng biệt:
              * Câu 19a -> Câu 19
              * Câu 19b -> Câu 20
              * Câu 19c -> Câu 21
              * Câu 19d -> Câu 22
              * Câu 20a -> Câu 23
              * ... tiếp tục cho đến Câu 22d -> Câu 34.
              (Tóm lại: Phần 2 tương ứng với các câu từ 19 đến 34).
            + Phần 3 (Câu 1 đến 6 - điền đáp án): Coi tiếp là các câu từ 35 đến 40.
              * Phần 3 Câu 1 -> Câu 35
              * ...
              * Phần 3 Câu 6 -> Câu 40.
          - Tổng số câu cần map: 40.
          `;
      }

      let prompt = `Nhiệm vụ: So sánh vị trí nội dung câu hỏi giữa các đề thi.
      
      Dữ liệu:
      - File 1: Mã đề chuẩn.
      - File 2, File 3...: Các đề thi khác (đã bị trộn câu hỏi từ File 1).
      
      ${specificPrompt}

      YÊU CẦU:
      Với từng câu hỏi (theo chỉ số đã quy đổi ở trên) của Mã đề chuẩn (File 1), hãy tìm xem nội dung câu hỏi đó nằm ở vị trí nào (theo chỉ số đã quy đổi) trong các đề còn lại.
      
      Output JSON format:
      Một mảng các object. Mỗi object đại diện cho một file đề thi (TRỪ đề chuẩn).
      Structure:
      {
         "examName": "Tên file đề thi",
         "mapping": [ ... mảng số nguyên ... ]
      }
      
      Giải thích mảng "mapping":
      - Phần tử tại index 0: Vị trí của "Câu 1 (File 1)" trong đề này.
      - Phần tử tại index 1: Vị trí của "Câu 2 (File 1)" trong đề này.
      - ...
      - Nếu không tìm thấy, trả về null.
      `;

      parts.push({ text: prompt });

      // Add files
      for (let i = 0; i < docFiles.length; i++) {
        const f = docFiles[i];
        parts.push({ text: `\n--- START OF FILE ${i + 1}: ${f.name} ---\n` });
        if (f.type === 'pdf') {
             parts.push({ inlineData: { mimeType: 'application/pdf', data: f.content } });
        } else {
             parts.push({ text: f.content });
        }
        parts.push({ text: `\n--- END OF FILE ${i + 1} ---\n` });
      }

      // USING FALLBACK STRATEGY
      const response = await generateWithFallback(ai, {
        contents: { parts },
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                examName: { type: Type.STRING },
                mapping: { type: Type.ARRAY, items: { type: Type.INTEGER } }
              },
              required: ["examName", "mapping"]
            }
          }
        }
      });

      if (response.text) {
        setAnalysisResult(JSON.parse(response.text));
      }

    } catch (e: any) {
      console.error(e);
      let msg = "Có lỗi xảy ra khi phân tích.";
      if (e.message && e.message.includes('429')) msg += " (Quá tải hệ thống - Vui lòng nhập Key cá nhân)";
      alert(msg);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const downloadComparisonWord = () => {
    if (!analysisResult || docFiles.length === 0) return;

    const maxQ = analysisType === 'math' ? 34 : 40;

    // First row is the Reference Exam
    let rowsHtml = '';
    
    // Header Row (Standard) - Yellow
    const refName = docFiles[0]?.name.replace(/\.[^/.]+$/, "") || 'Mã đề gốc';
    let row1 = `<td style="background-color:${TABLE_COLORS[0]}; font-weight:bold; padding:5px;">${refName} (Gốc)</td>`;
    for(let i=1; i<=maxQ; i++) {
        row1 += `<td style="background-color:${TABLE_COLORS[0]}; text-align:center; font-weight:bold; width:30px;">${i}</td>`;
    }
    rowsHtml += `<tr>${row1}</tr>`;

    // Other Rows
    analysisResult.forEach((res, idx) => {
       const color = TABLE_COLORS[(idx + 1) % TABLE_COLORS.length];
       let row = `<td style="background-color:${color}; font-weight:bold; padding:5px;">${res.examName.replace(/\.[^/.]+$/, "")}</td>`;
       
       // Ensure mapping has enough items or truncate if needed, though prompt should handle it.
       // We iterate up to maxQ.
       for(let i=0; i<maxQ; i++) {
           const val = res.mapping[i];
           row += `<td style="background-color:${color}; text-align:center; width:30px;">${val || '-'}</td>`;
       }
       rowsHtml += `<tr>${row}</tr>`;
    });

    const fullHtml = `
      <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word'>
      <head><meta charset="utf-8"><title>Bảng So Sánh</title></head>
      <body style="font-family:'Times New Roman',serif;">
        <h2 style="text-align:center; color:#1e3a8a;">BẢNG SO SÁNH CÂU HỎI (${analysisType === 'math' ? 'TOÁN' : (analysisType === 'english' ? 'TIẾNG ANH' : 'KHTN')})</h2>
        <table border="1" style="border-collapse:collapse; width:100%; font-size:12px;">
          ${rowsHtml}
        </table>
      </body>
      </html>
    `;

    const blob = new Blob(['\ufeff', fullHtml], { type: 'application/msword' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `Bang_So_Sanh_${refName}.doc`;
    link.click();
  };

  // --------------------------------------------------------------------------
  //                               RENDER
  // --------------------------------------------------------------------------

  // Settings Overlay View
  if (showSettings) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: '#f8fafc', zIndex: 2000, display: 'flex' }}>
         {/* Sidebar */}
         <div style={{ width: '300px', background: '#1e3a8a', color: 'white', display: 'flex', flexDirection: 'column', borderRight: '1px solid #172554' }}>
            <div style={{ padding: '20px' }}>
               <button 
                 onClick={() => setShowSettings(false)}
                 style={{ 
                    background: 'rgba(255,255,255,0.15)', border: 'none', color: 'white', padding: '10px 16px', 
                    borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600, width: '100%'
                 }}>
                 <ArrowLeft size={18} /> Quay lại
               </button>
            </div>
            
            <div style={{ marginTop: '20px' }}>
                <div style={{ padding: '10px 20px', fontSize: '12px', color: '#bfdbfe', fontWeight: 700, textTransform: 'uppercase' }}>Thông tin tác giả</div>
                <div 
                   onClick={() => setSettingsTab('author')}
                   style={{ 
                     padding: '12px 20px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '12px',
                     background: settingsTab === 'author' ? '#172554' : 'transparent', borderLeft: settingsTab === 'author' ? '4px solid #60a5fa' : '4px solid transparent'
                   }}>
                   <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: '#60a5fa', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, color: '#1e3a8a' }}>H</div>
                   <div>
                       <div style={{ fontSize: '14px', fontWeight: 600 }}>Nguyễn Đức Hiền</div>
                       <div style={{ fontSize: '11px', color: '#dbeafe' }}>Giáo viên Vật Lí</div>
                   </div>
                </div>
            </div>

            <div style={{ marginTop: '20px' }}>
                <div style={{ padding: '10px 20px', fontSize: '12px', color: '#bfdbfe', fontWeight: 700, textTransform: 'uppercase' }}>Cấu hình hệ thống</div>
                <div 
                   onClick={() => setSettingsTab('config')}
                   style={{ 
                     padding: '12px 20px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '12px',
                     background: settingsTab === 'config' ? '#172554' : 'transparent', borderLeft: settingsTab === 'config' ? '4px solid #60a5fa' : '4px solid transparent'
                   }}>
                   <Key size={18} color="#dbeafe" />
                   <div style={{ fontSize: '14px', fontWeight: 600 }}>GOOGLE GEMINI API KEY</div>
                </div>
            </div>
         </div>

         {/* Content */}
         <div style={{ flex: 1, overflowY: 'auto', display: 'flex', justifyContent: 'center', alignItems: 'center', background: '#f1f5f9' }}>
             {settingsTab === 'author' && (
                 <div style={{ background: 'white', padding: '60px', borderRadius: '24px', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1)', textAlign: 'center', maxWidth: '600px', width: '100%' }}>
                     <div style={{ width: '100px', height: '100px', borderRadius: '50%', background: '#2563eb', color: 'white', fontSize: '48px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px auto' }}>H</div>
                     <h2 style={{ fontSize: '28px', color: '#1e3a8a', margin: '0 0 10px 0' }}>Nguyễn Đức Hiền</h2>
                     <div style={{ fontSize: '18px', color: '#2563eb', fontWeight: 500, marginBottom: '20px' }}>Giáo viên Vật Lí</div>
                     <div style={{ width: '50px', height: '2px', background: '#e2e8f0', margin: '0 auto 20px auto' }}></div>
                     <p style={{ fontSize: '16px', color: '#475569', margin: 0 }}>Trường THCS và THPT Nguyễn Khuyến Bình Dương</p>
                     
                     <div style={{ marginTop: '40px', padding: '20px', background: '#eff6ff', borderRadius: '12px', border: '1px solid #bfdbfe' }}>
                         <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', color: '#1e40af', fontWeight: 600, marginBottom: '5px' }}>
                            <Info size={18} /> Thông tin ứng dụng
                         </div>
                         <div style={{ fontSize: '14px', color: '#1e3a8a' }}>Phiên bản: 1.0 (Công cụ trộn đề NK12)</div>
                         <div style={{ fontSize: '12px', color: '#60a5fa', marginTop: '5px' }}>© 2025 Bản quyền thuộc về tác giả.</div>
                     </div>
                 </div>
             )}

             {settingsTab === 'config' && (
                 <div style={{ background: 'white', padding: '40px', borderRadius: '24px', boxShadow: '0 4px 20px rgba(0,0,0,0.05)', maxWidth: '700px', width: '100%' }}>
                     {/* Header */}
                     <div style={{ display: 'flex', gap: '20px', marginBottom: '30px' }}>
                         <div style={{ width: '60px', height: '60px', borderRadius: '50%', background: '#dbeafe', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                             <Key size={30} color="#2563eb" />
                         </div>
                         <div>
                             <h2 style={{ fontSize: '24px', margin: '0 0 8px 0', color: '#1e293b', fontWeight: 700 }}>Cấu hình API Key</h2>
                             <p style={{ margin: 0, color: '#64748b', fontSize: '15px' }}>Nhập Key cá nhân của bạn để sử dụng tính năng AI không giới hạn.</p>
                         </div>
                     </div>

                     {/* Input Section */}
                     <div style={{ marginBottom: '20px' }}>
                         <label style={{ display: 'block', fontSize: '15px', fontWeight: 600, color: '#334155', marginBottom: '10px' }}>Google Gemini API Key</label>
                         <div style={{ position: 'relative' }}>
                             <input 
                                 type={showKey ? "text" : "password"} 
                                 value={userApiKey}
                                 onChange={(e) => setUserApiKey(e.target.value)}
                                 placeholder="• • • • • • • • • • • • • • • • • • • • • • • •"
                                 style={{ 
                                     width: '100%', padding: '14px 45px 14px 20px', borderRadius: '12px', border: '1px solid #cbd5e1', 
                                     fontSize: '16px', outline: 'none', background: '#f8fafc', color: '#334155', transition: 'border 0.2s'
                                 }}
                                 onFocus={(e) => e.target.style.borderColor = '#3b82f6'}
                                 onBlur={(e) => e.target.style.borderColor = '#cbd5e1'}
                             />
                             <button 
                                 onClick={() => setShowKey(!showKey)}
                                 style={{ 
                                     position: 'absolute', right: '15px', top: '50%', transform: 'translateY(-50%)', 
                                     background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8'
                                 }}>
                                 {showKey ? <EyeOff size={20} /> : <Eye size={20} />}
                             </button>
                         </div>
                         
                         <p style={{ fontSize: '13px', color: '#64748b', marginTop: '12px' }}>
                             Key được lưu trong trình duyệt của bạn. • 
                             <span style={{ color: userApiKey ? '#16a34a' : (DEFAULT_OWNER_KEY ? '#16a34a' : '#f59e0b'), fontWeight: 600 }}>
                                {userApiKey ? ' Đang dùng Key cá nhân' : (DEFAULT_OWNER_KEY ? ' Đang dùng Key mặc định của hệ thống' : ' Chưa có Key')}
                             </span>
                         </p>
                     </div>

                     <div style={{ height: '1px', background: '#e2e8f0', margin: '30px 0' }}></div>

                     {/* Instructions */}
                     <div>
                         <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#334155', marginBottom: '15px' }}>Hướng dẫn lấy Key (nếu muốn dùng riêng):</h3>
                         <ul style={{ margin: 0, paddingLeft: '20px', color: '#475569', fontSize: '15px', lineHeight: '1.8' }}>
                             <li>Truy cập <a href="https://aistudio.google.com/" target="_blank" rel="noreferrer" style={{ color: '#2563eb', textDecoration: 'none', fontWeight: 500 }}>Google AI Studio</a>.</li>
                             <li>Đăng nhập tài khoản Google.</li>
                             <li>Chọn "Create API Key" và copy dán vào ô trên.</li>
                         </ul>
                     </div>
                 </div>
             )}
         </div>
      </div>
    );
  }

  // Regular App Render
  return (
    <div style={{ maxWidth: '1800px', margin: '0 auto', padding: '20px', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      
      {/* --- HEADER --- */}
      <header style={{ 
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', 
        background: '#1c4dbd', padding: '20px 30px', borderRadius: '16px', color: 'white'
      }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '12px' }}>
            <FileText size={28} color="#ccd2e0" /> Hỗ trợ chấm bài NK12
          </h1>
          <p style={{ margin: '5px 0 0', color: '#94a3b8', fontSize: '14px' }}>Công cụ hỗ trợ giáo viên chấm thi và phân tích đề</p>
        </div>
      </header>

      {/* --- TABS --- */}
      <div style={{ display: 'flex', gap: '20px', marginBottom: '20px', borderBottom: '1px solid #e2e8f0' }}>
        <button 
          className={`tab-button ${activeTab === 'answers' ? 'active' : ''}`}
          onClick={() => setActiveTab('answers')}>
          Đáp án
        </button>
        <button 
          className={`tab-button ${activeTab === 'analysis' ? 'active' : ''}`}
          onClick={() => setActiveTab('analysis')}>
          Phân tích câu
        </button>
      </div>

      {/* --- CONTENT: ANSWERS TAB --- */}
      {activeTab === 'answers' && (
        <>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '15px' }}>
                <button 
                onClick={analyzeAll}
                style={{ 
                    backgroundColor: '#2563eb', color: 'white', border: 'none', padding: '10px 20px', 
                    borderRadius: '8px', cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px'
                }}>
                <Check size={18} /> Phân tích tất cả
                </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', gap: '20px' }}>
                {subjects.map((subject, index) => (
                <div 
                    key={subject.id}
                    className="subject-card"
                    tabIndex={0}
                    onPaste={(e) => handlePaste(e, subject.id)}
                    onDrop={(e) => handleDrop(e, subject.id)}
                    onDragOver={(e) => e.preventDefault()}
                    style={{ 
                    background: 'white', borderRadius: '16px', overflow: 'hidden', 
                    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column'
                    }}
                >
                    {/* Header */}
                    <div style={{ backgroundColor: subject.color, padding: '15px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3 style={{ margin: 0, color: 'white', fontSize: '18px', fontWeight: 700 }}>{subject.name}</h3>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: subject.color, background: 'white', padding: '3px 8px', borderRadius: '12px' }}>
                        {subject.imageIds.length} ảnh
                    </span>
                    </div>

                    {/* Content Area */}
                    <div style={{ padding: '15px', minHeight: '150px', flex: 1, display: 'flex', flexDirection: 'column' }}>
                    {/* Image List */}
                    {subject.imageIds.length === 0 ? (
                        <div 
                        onClick={() => document.getElementById(`file-input-${subject.id}`)?.click()}
                        style={{ 
                            flex: 1, border: '2px dashed #cbd5e1', borderRadius: '12px', padding: '20px', 
                            cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#64748b'
                        }}>
                        <Upload size={24} style={{ marginBottom: '10px', opacity: 0.5 }} />
                        <div style={{ fontSize: '13px', fontWeight: 500 }}>Tải ảnh, PDF / Ctrl+V</div>
                        </div>
                    ) : (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(70px, 1fr))', gap: '8px', marginBottom: '15px' }}>
                        {subject.imageIds.map(imgId => {
                            const imgItem = images[imgId];
                            const isPdf = imgItem.file.type === 'application/pdf';
                            return (
                            <div 
                                key={imgId} 
                                onClick={() => { setInspectImageId(imgId); setInspectSubjectId(subject.id); setZoomLevel(1); }}
                                title="Bấm để xem chi tiết"
                                style={{ 
                                aspectRatio: '1', borderRadius: '6px', overflow: 'hidden', position: 'relative', 
                                border: '1px solid #e2e8f0', cursor: 'zoom-in'
                                }}>
                                {isPdf ? (
                                <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#f1f5f9', color: '#475569' }}>
                                    <FileText size={24} />
                                    <span style={{ fontSize: '9px', marginTop: '4px', padding: '0 5px', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>PDF</span>
                                </div>
                                ) : (
                                <img src={imgItem.url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                )}
                                <div className="hover-overlay" style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.1)', opacity: 0, transition: 'opacity 0.2s' }} />
                                <button 
                                onClick={(e) => { e.stopPropagation(); removeImage(imgId, subject.id); }}
                                style={{ 
                                    position: 'absolute', top: '2px', right: '2px', background: 'rgba(0,0,0,0.6)', 
                                    color: 'white', border: 'none', width: '18px', height: '18px', borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center'
                                }}>
                                <X size={10} />
                                </button>
                            </div>
                            );
                        })}
                        <div 
                            onClick={() => document.getElementById(`file-input-${subject.id}`)?.click()}
                            style={{ 
                            aspectRatio: '1', borderRadius: '6px', border: '2px dashed #cbd5e1', display: 'flex', 
                            alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#94a3b8'
                            }}>
                            <Plus size={20} />
                        </div>
                        </div>
                    )}
                    <input id={`file-input-${subject.id}`} type="file" multiple accept="image/*,application/pdf" onChange={(e) => handleFileUpload(e, subject.id)} style={{ display: 'none' }} />

                    {/* Preview Results (Compact) */}
                    {subject.isLoading ? (
                        <div style={{ display: 'flex', justifyContent: 'center', padding: '20px', color: subject.color }}>
                        <Loader2 className="spin" />
                        </div>
                    ) : subject.results && (
                        <div style={{ marginTop: 'auto', paddingTop: '10px', borderTop: '1px solid #f1f5f9' }}>
                            <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '8px' }}>Tìm thấy {subject.results.length} mã đề:</div>
                            <div style={{ fontSize: '13px', display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                                {subject.results.map((exam, idx) => (
                                    <div key={idx} style={{ 
                                    background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '4px', 
                                    padding: '4px 8px', color: '#1e40af', fontWeight: 600
                                    }}>
                                    Mã {exam.code}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                    </div>

                    {/* Actions */}
                    <div style={{ padding: '15px', borderTop: '1px solid #f1f5f9', background: '#f8fafc', display: 'flex', gap: '8px' }}>
                    {subject.results ? (
                        <>
                        <button 
                            onClick={() => downloadWord(subject)}
                            style={{ flex: 1, padding: '8px', background: 'white', border: '1px solid #cbd5e1', borderRadius: '6px', fontWeight: 600, color: '#334155', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                            <Download size={14} /> Word
                        </button>
                        <button 
                            onClick={() => analyzeSubject(index)} 
                            style={{ padding: '8px', background: 'white', border: '1px solid #cbd5e1', borderRadius: '6px', color: subject.color, cursor: 'pointer' }}
                            title="Quét lại">
                            <Check size={16} />
                        </button>
                        </>
                    ) : (
                        <button 
                        onClick={() => analyzeSubject(index)}
                        disabled={subject.imageIds.length === 0}
                        style={{ 
                            width: '100%', padding: '10px', background: subject.imageIds.length === 0 ? '#e2e8f0' : subject.color, 
                            color: subject.imageIds.length === 0 ? '#94a3b8' : 'white', border: 'none', borderRadius: '6px', 
                            cursor: subject.imageIds.length === 0 ? 'not-allowed' : 'pointer', fontWeight: 600
                        }}>
                        Tạo bảng đáp án
                        </button>
                    )}
                    </div>
                </div>
                ))}
            </div>
        </>
      )}

      {/* --- CONTENT: ANALYSIS TAB --- */}
      {activeTab === 'analysis' && (
        <div style={{ display: 'flex', gap: '30px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
            {/* Left Column: File Manager */}
            <div style={{ flex: '1 1 400px', background: 'white', padding: '20px', borderRadius: '16px', border: '1px solid #e2e8f0' }}>
               <h3 style={{ marginTop: 0, color: '#334155', display: 'flex', alignItems: 'center', gap: '10px' }}>
                   <Upload size={20} /> Tải đề thi
               </h3>
               <p style={{ fontSize: '13px', color: '#64748b' }}>Hỗ trợ PDF, DOCX. File đầu tiên sẽ là "Mã đề chuẩn".</p>
               
               <div 
                  onClick={() => document.getElementById('doc-upload')?.click()}
                  style={{ 
                    border: '2px dashed #cbd5e1', borderRadius: '12px', padding: '30px', 
                    cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', 
                    color: '#64748b', marginBottom: '20px', background: '#f8fafc'
                  }}>
                   <Plus size={32} style={{ marginBottom: '10px', opacity: 0.5 }} />
                   <div style={{ fontWeight: 600 }}>Thêm file đề thi</div>
               </div>
               <input id="doc-upload" type="file" multiple accept=".pdf,.docx,.doc" onChange={handleDocUpload} style={{ display: 'none' }} />

               <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                   {docFiles.map((file, idx) => (
                       <div key={file.id} style={{ 
                           display: 'flex', alignItems: 'center', gap: '10px', padding: '10px', 
                           background: idx === 0 ? '#eff6ff' : 'white', 
                           border: `1px solid ${idx === 0 ? '#3b82f6' : '#e2e8f0'}`, borderRadius: '8px' 
                       }}>
                           <div style={{ 
                               width: '24px', height: '24px', background: '#e2e8f0', borderRadius: '50%', 
                               display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 'bold' 
                           }}>
                               {idx + 1}
                           </div>
                           <div style={{ flex: 1, overflow: 'hidden' }}>
                               <div style={{ fontWeight: 600, fontSize: '14px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{file.name}</div>
                               <div style={{ fontSize: '11px', color: '#64748b' }}>{file.type.toUpperCase()} {idx === 0 ? '- Đề chuẩn' : ''}</div>
                           </div>
                           <div style={{ display: 'flex', gap: '2px' }}>
                               <button onClick={() => moveDocFile(idx, 'up')} disabled={idx === 0} style={iconBtnStyle}><ArrowUp size={14}/></button>
                               <button onClick={() => moveDocFile(idx, 'down')} disabled={idx === docFiles.length - 1} style={iconBtnStyle}><ArrowDown size={14}/></button>
                               <button onClick={() => removeDocFile(file.id)} style={{...iconBtnStyle, color: '#ef4444'}}><Trash2 size={14}/></button>
                           </div>
                       </div>
                   ))}
               </div>
            </div>

            {/* Right Column: Actions & Results */}
            <div style={{ flex: '2 1 600px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <div style={{ background: 'white', padding: '20px', borderRadius: '16px', border: '1px solid #e2e8f0', textAlign: 'center' }}>
                    <h3 style={{ margin: '0 0 15px 0', color: '#334155' }}>Chọn môn để so sánh</h3>
                    
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '15px' }}>
                        <button 
                            onClick={() => compareExams('math')}
                            disabled={docFiles.length < 2 || isAnalyzing}
                            className="compare-btn"
                            style={{ 
                                background: isAnalyzing ? '#cbd5e1' : '#eff6ff', 
                                border: '2px solid #2563eb', color: '#2563eb'
                            }}>
                            {isAnalyzing ? <Loader2 className="spin" size={20}/> : <Calculator size={24} />}
                            <span style={{ fontSize: '14px', fontWeight: 600 }}>Toán học</span>
                        </button>
                        
                        <button 
                            onClick={() => compareExams('science')}
                            disabled={docFiles.length < 2 || isAnalyzing}
                            className="compare-btn"
                            style={{ 
                                background: isAnalyzing ? '#cbd5e1' : '#f0fdf4', 
                                border: '2px solid #16a34a', color: '#16a34a'
                            }}>
                            {isAnalyzing ? <Loader2 className="spin" size={20}/> : <FlaskConical size={24} />}
                            <span style={{ fontSize: '14px', fontWeight: 600 }}>KHTN (Lý/Hóa/Sinh)</span>
                        </button>
                        
                        <button 
                            onClick={() => compareExams('english')}
                            disabled={docFiles.length < 2 || isAnalyzing}
                            className="compare-btn"
                            style={{ 
                                background: isAnalyzing ? '#cbd5e1' : '#fff7ed', 
                                border: '2px solid #c2410c', color: '#c2410c'
                            }}>
                            {isAnalyzing ? <Loader2 className="spin" size={20}/> : <Languages size={24} />}
                            <span style={{ fontSize: '14px', fontWeight: 600 }}>Tiếng Anh</span>
                        </button>
                    </div>

                    {docFiles.length < 2 && <p style={{ color: '#ef4444', fontSize: '13px', marginTop: '15px' }}>Vui lòng tải lên ít nhất 2 đề thi.</p>}
                </div>

                {analysisResult && docFiles.length > 0 && (
                    <div style={{ background: 'white', padding: '20px', borderRadius: '16px', border: '1px solid #e2e8f0' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                             <h3 style={{ margin: 0, color: '#334155' }}>Kết quả so sánh {analysisType === 'math' ? '(Toán)' : (analysisType === 'science' ? '(KHTN)' : '(Tiếng Anh)')}</h3>
                             <button 
                                onClick={downloadComparisonWord}
                                style={{ 
                                    background: '#16a34a', color: 'white', border: 'none', padding: '8px 16px', 
                                    borderRadius: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600 
                                }}>
                                <Download size={16} /> Tải file Word
                             </button>
                        </div>
                        
                        <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
                             <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', minWidth: '1200px' }}>
                                 <thead>
                                     <tr>
                                         <th style={{ padding: '10px', background: TABLE_COLORS[0], border: '1px solid #cbd5e1', minWidth: '150px' }}>{docFiles[0]?.name || 'Chưa có file'} (Gốc)</th>
                                         {Array.from({length: analysisType === 'math' ? 34 : 40}, (_, i) => (
                                             <th key={i} style={{ padding: '8px', background: TABLE_COLORS[0], border: '1px solid #cbd5e1', width: '30px' }}>{i + 1}</th>
                                         ))}
                                     </tr>
                                 </thead>
                                 <tbody>
                                     {analysisResult.map((res, rowIdx) => (
                                         <tr key={rowIdx}>
                                             <td style={{ padding: '10px', border: '1px solid #cbd5e1', fontWeight: 600, background: TABLE_COLORS[(rowIdx + 1) % TABLE_COLORS.length] }}>
                                                 {res.examName}
                                             </td>
                                             {/* Render cells based on max columns */}
                                             {Array.from({length: analysisType === 'math' ? 34 : 40}).map((_, colIdx) => (
                                                 <td key={colIdx} style={{ padding: '8px', border: '1px solid #cbd5e1', textAlign: 'center', background: TABLE_COLORS[(rowIdx + 1) % TABLE_COLORS.length] }}>
                                                     {res.mapping[colIdx] || '-'}
                                                 </td>
                                             ))}
                                         </tr>
                                     ))}
                                 </tbody>
                             </table>
                        </div>
                    </div>
                )}
            </div>
        </div>
      )}

      {/* --- INSPECTOR MODAL (Existing) --- */}
      {inspectImageId && inspectSubjectId && (
        <div style={{ 
          position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.9)', zIndex: 1000, 
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px'
        }}>
          <div style={{ 
            width: '95vw', height: '90vh', background: 'white', borderRadius: '16px', overflow: 'hidden', 
            display: 'flex', flexDirection: 'column', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)'
          }}>
            <div style={{ 
              padding: '15px 20px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              background: '#f8fafc'
            }}>
              <div style={{ fontWeight: 700, fontSize: '16px', color: '#334155' }}>Kiểm tra & Đối chiếu</div>
              <div style={{ display: 'flex', gap: '10px' }}>
                 <button onClick={() => setZoomLevel(prev => Math.max(0.5, prev - 0.25))} style={btnIconStyle}><ZoomOut size={18} /></button>
                 <span style={{ display: 'flex', alignItems: 'center', fontSize: '13px', fontWeight: 600, width: '40px', justifyContent: 'center' }}>{Math.round(zoomLevel * 100)}%</span>
                 <button onClick={() => setZoomLevel(prev => Math.min(3, prev + 0.25))} style={btnIconStyle}><ZoomIn size={18} /></button>
                 <div style={{ width: '1px', height: '20px', background: '#cbd5e1', margin: '0 10px' }}></div>
                 <button onClick={() => { setInspectImageId(null); setInspectSubjectId(null); }} style={{ ...btnIconStyle, color: '#ef4444', background: '#fee2e2' }}><X size={18} /></button>
              </div>
            </div>
            <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
              <div style={{ flex: 1, background: '#1e293b', overflow: 'hidden', display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '0' }}>
                 {(() => {
                   const inspectItem = images[inspectImageId];
                   const isPdf = inspectItem.file.type === 'application/pdf';
                   if (isPdf) {
                     return <iframe src={inspectItem.url} style={{ width: '100%', height: '100%', border: 'none' }} title="PDF Preview" />;
                   }
                   return (
                     <div style={{ width: '100%', height: '100%', overflow: 'auto', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: '20px' }}>
                        <img src={inspectItem.url} style={{ maxWidth: 'none', width: `${zoomLevel * 100}%`, transformOrigin: 'top center', transition: 'width 0.2s' }} />
                     </div>
                   );
                 })()}
              </div>
              <div style={{ width: '400px', borderLeft: '1px solid #e2e8f0', background: 'white', display: 'flex', flexDirection: 'column' }}>
                <div style={{ padding: '20px', overflowY: 'auto', flex: 1 }}>
                  {(() => {
                    const subj = subjects.find(s => s.id === inspectSubjectId);
                    if (!subj) return null;
                    return (
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                          <h2 style={{ margin: 0, fontSize: '20px', color: subj.color }}>{subj.name}</h2>
                          {subj.isLoading && <Loader2 className="spin" size={20} color={subj.color} />}
                        </div>
                        {(!subj.results && !subj.isLoading) ? (
                           <div style={{ textAlign: 'center', color: '#64748b', padding: '40px 0' }}>
                             <p>Chưa có dữ liệu phân tích.</p>
                             <button onClick={() => analyzeSubject(subjects.indexOf(subj))} style={{ padding: '8px 16px', background: subj.color, color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>Chạy phân tích ngay</button>
                           </div>
                        ) : (
                            <div style={{ fontSize: '14px' }}>
                            {subj.results?.map((exam, examIdx) => {
                                const flatData = flattenExamData(exam, subj.type);
                                return (
                                <div key={examIdx} style={{ marginBottom: '30px', paddingBottom: '20px', borderBottom: examIdx < subj.results!.length - 1 ? '2px dashed #e2e8f0' : 'none' }}>
                                    <h3 style={{ background: '#f1f5f9', padding: '10px', borderRadius: '6px', color: '#334155', borderLeft: '4px solid var(--primary-color)', marginBottom: '15px' }}>Mã đề: {exam.code}</h3>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(10, 1fr)', border: '1px solid #cbd5e1', borderRight: 'none', borderBottom: 'none' }}>
                                        {flatData.map((item, i) => (
                                        <div key={i} style={{ borderRight: '1px solid #cbd5e1', borderBottom: '1px solid #cbd5e1', padding: '8px 2px', textAlign: 'center', fontSize: '13px', fontWeight: 700, background: 'white' }}>{item}</div>
                                        ))}
                                        {Array.from({ length: Math.ceil(flatData.length / 10) * 10 - flatData.length }).map((_, i) => (
                                        <div key={`empty-${i}`} style={{ borderRight: '1px solid #cbd5e1', borderBottom: '1px solid #cbd5e1', background: '#f9fafb' }}></div>
                                        ))}
                                    </div>
                                </div>
                                );
                            })}
                            </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* --- SETTINGS BUTTON (Bottom Left) --- */}
      <div 
        onClick={() => setShowSettings(true)}
        style={{ 
          position: 'fixed', bottom: '20px', left: '20px', zIndex: 100, 
          background: 'white', border: '1px solid #cbd5e1', borderRadius: '50px', 
          padding: '10px 20px', cursor: 'pointer', boxShadow: '0 4px 10px rgba(0,0,0,0.1)',
          display: 'flex', alignItems: 'center', gap: '8px', color: '#1e3a8a', fontWeight: 600
        }}>
         <Settings size={20} /> Cài đặt
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .subject-card:hover .hover-overlay { opacity: 1 !important; }
        .subject-card:focus { outline: 3px solid #3b82f6; }
        .compare-btn {
           display: flex;
           flex-direction: column;
           align-items: center;
           justify-content: center;
           padding: 20px;
           border-radius: 12px;
           gap: 10px;
           cursor: pointer;
           transition: all 0.2s;
        }
        .compare-btn:hover:not(:disabled) {
           filter: brightness(0.95);
           transform: translateY(-2px);
        }
        .compare-btn:disabled {
           opacity: 0.6;
           cursor: not-allowed;
           border-color: #cbd5e1 !important;
           background: #e2e8f0 !important;
           color: #94a3b8 !important;
        }
      `}</style>
    </div>
  );
};

const btnIconStyle: React.CSSProperties = {
  width: '32px', height: '32px', borderRadius: '6px', border: '1px solid #cbd5e1',
  background: 'white', color: '#475569', display: 'flex', alignItems: 'center', justifyContent: 'center',
  cursor: 'pointer'
};

const iconBtnStyle: React.CSSProperties = {
    background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px',
    color: '#64748b', display: 'flex', alignItems: 'center'
}

const root = createRoot(document.getElementById('root')!);
root.render(<App />);