import React, { useState, useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Type, Schema } from "@google/genai";
import { Upload, FileText, Download, Trash2, X, Check, Loader2, Image as ImageIcon, Clipboard, Plus, Eye, ZoomIn, ZoomOut, Maximize2, ArrowUp, ArrowDown, Shuffle } from 'lucide-react';

// Declare mammoth for TypeScript (loaded via script tag)
declare const mammoth: any;

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
      if (mammoth) {
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

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

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
    const common = "Nhiệm vụ: Tìm và trích xuất bảng đáp án cho TẤT CẢ các Mã Đề (exam codes) có trong tài liệu được cung cấp. Trả về danh sách, mỗi phần tử tương ứng với một mã đề.";
    if (subject.type === 'english') {
      return `${common} Môn Tiếng Anh: Mỗi mã đề gồm 40 câu trắc nghiệm (1-40).`;
    } else {
      const p1Count = subject.type === 'math' ? 12 : 18;
      return `${common} Form mới 2025. Phần 1: ${p1Count} câu nhiều lựa chọn. Phần 2: 4 câu đúng sai. Phần 3: 6 câu trả lời ngắn.`;
    }
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
    setSubjects(prev => prev.map((s, i) => i === subjectIndex ? { ...s, isLoading: true, error: null } : s));
    try {
      const parts = [];
      parts.push({ text: getSystemInstruction(subject) });
      for (const imgId of subject.imageIds) {
        const imgItem = images[imgId];
        parts.push({ inlineData: { mimeType: imgItem.file.type || 'image/jpeg', data: imgItem.base64 } });
      }
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: { parts },
        config: { responseMimeType: 'application/json', responseSchema: getSchema(subject) }
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
    } catch (error) {
      console.error("AI Error:", error);
      setSubjects(prev => prev.map((s, i) => i === subjectIndex ? { ...s, isLoading: false, error: "Lỗi khi phân tích. Vui lòng thử lại." } : s));
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
  };

  const moveDocFile = (index: number, direction: 'up' | 'down') => {
    const newFiles = [...docFiles];
    if (direction === 'up' && index > 0) {
      [newFiles[index], newFiles[index - 1]] = [newFiles[index - 1], newFiles[index]];
    } else if (direction === 'down' && index < newFiles.length - 1) {
      [newFiles[index], newFiles[index + 1]] = [newFiles[index + 1], newFiles[index]];
    }
    setDocFiles(newFiles);
  };

  const compareExams = async () => {
    if (docFiles.length < 2) return;
    setIsAnalyzing(true);
    setAnalysisResult(null);

    try {
      // Prompt construction
      const parts = [];
      let prompt = `Nhiệm vụ: So sánh các câu hỏi giữa các đề thi.
      
      Dữ liệu cung cấp bao gồm nhiều đề thi. 
      Đề thi đầu tiên (File 1) là "Mã đề chuẩn".
      Các đề thi tiếp theo (File 2, File 3...) là các đề đã được trộn câu hỏi từ File 1.

      Hãy phân tích nội dung từng câu hỏi. 
      Với mỗi câu hỏi từ 1 đến 40 của Mã đề chuẩn (File 1), hãy tìm xem nó nằm ở vị trí câu số mấy trong các đề còn lại.
      
      Yêu cầu đầu ra JSON:
      Một mảng các object. Mỗi object đại diện cho một đề thi (TRỪ đề chuẩn).
      Structure:
      {
         "examName": "Tên file đề thi",
         "mapping": [ ... mảng gồm 40 số nguyên ... ]
      }
      
      Giải thích mảng "mapping":
      - Phần tử tại index 0 ứng với Câu 1 của Mã đề chuẩn. Giá trị của nó là số thứ tự câu hỏi trong đề này.
      - Phần tử tại index 1 ứng với Câu 2 của Mã đề chuẩn.
      ...
      - Nếu không tìm thấy câu tương ứng, để giá trị null.

      Ví dụ: Nếu Câu 1 của Đề Chuẩn là Câu 18 của Đề B, thì mapping[0] = 18.
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

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
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

    } catch (e) {
      console.error(e);
      alert("Có lỗi xảy ra khi phân tích. Vui lòng thử lại.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const downloadComparisonWord = () => {
    if (!analysisResult || docFiles.length === 0) return;

    // First row is the Reference Exam (1-40)
    let rowsHtml = '';
    
    // Header Row (Standard 1-40) - Yellow
    const refName = docFiles[0].name.replace(/\.[^/.]+$/, "");
    let row1 = `<td style="background-color:${TABLE_COLORS[0]}; font-weight:bold; padding:5px;">${refName} (Gốc)</td>`;
    for(let i=1; i<=40; i++) {
        row1 += `<td style="background-color:${TABLE_COLORS[0]}; text-align:center; font-weight:bold; width:30px;">${i}</td>`;
    }
    rowsHtml += `<tr>${row1}</tr>`;

    // Other Rows
    analysisResult.forEach((res, idx) => {
       const color = TABLE_COLORS[(idx + 1) % TABLE_COLORS.length];
       let row = `<td style="background-color:${color}; font-weight:bold; padding:5px;">${res.examName.replace(/\.[^/.]+$/, "")}</td>`;
       
       res.mapping.forEach(val => {
         row += `<td style="background-color:${color}; text-align:center; width:30px;">${val || '-'}</td>`;
       });
       rowsHtml += `<tr>${row}</tr>`;
    });

    const fullHtml = `
      <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word'>
      <head><meta charset="utf-8"><title>Bảng So Sánh</title></head>
      <body style="font-family:'Times New Roman',serif;">
        <h2 style="text-align:center; color:#1e3a8a;">BẢNG SO SÁNH CÂU HỎI</h2>
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
                    <h3 style={{ margin: '0 0 15px 0', color: '#334155' }}>Phân tích & So sánh</h3>
                    <button 
                        onClick={compareExams}
                        disabled={docFiles.length < 2 || isAnalyzing}
                        style={{ 
                            background: isAnalyzing ? '#94a3b8' : '#2563eb', color: 'white', border: 'none', 
                            padding: '12px 30px', borderRadius: '8px', fontSize: '16px', fontWeight: 600, 
                            cursor: isAnalyzing ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: '10px'
                        }}>
                        {isAnalyzing ? <Loader2 className="spin" /> : <Shuffle size={20} />}
                        {isAnalyzing ? 'Đang phân tích...' : 'So sánh câu hỏi'}
                    </button>
                    {docFiles.length < 2 && <p style={{ color: '#ef4444', fontSize: '13px', marginTop: '10px' }}>Vui lòng tải lên ít nhất 2 đề thi.</p>}
                </div>

                {analysisResult && (
                    <div style={{ background: 'white', padding: '20px', borderRadius: '16px', border: '1px solid #e2e8f0' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                             <h3 style={{ margin: 0, color: '#334155' }}>Kết quả so sánh</h3>
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
                                         <th style={{ padding: '10px', background: TABLE_COLORS[0], border: '1px solid #cbd5e1', minWidth: '150px' }}>{docFiles[0].name} (Gốc)</th>
                                         {Array.from({length: 40}, (_, i) => (
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
                                             {res.mapping.map((val, colIdx) => (
                                                 <td key={colIdx} style={{ padding: '8px', border: '1px solid #cbd5e1', textAlign: 'center', background: TABLE_COLORS[(rowIdx + 1) % TABLE_COLORS.length] }}>
                                                     {val || '-'}
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

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .subject-card:hover .hover-overlay { opacity: 1 !important; }
        .subject-card:focus { outline: 3px solid #3b82f6; }
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
