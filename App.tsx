



import React, { useState, useCallback, useEffect, useRef } from 'react';
import type { Crop } from 'react-image-crop';
import useLocalStorage from './hooks/useLocalStorage';
import { DEFAULT_SYSTEM_PROMPT, DEFAULT_TEMPERATURE } from './constants';
import { transcribeImage } from './services/geminiService';
import { Settings } from './components/Settings';
import { SkeletonLoader } from './components/Spinner';
import { UploadIcon, CopyIcon, CheckIcon, XCircleIcon, CropIcon, ChevronDownIcon, ClipboardIcon, SparklesIcon } from './components/icons';
import { PdfSelectionModal } from './components/PdfSelectionModal';
import { ImageEditorModal } from './components/ImageEditorModal';
import { ExportModal, ExportFormat } from './components/ExportModal';
import * as pdfjsLib from 'pdfjs-dist/build/pdf.mjs';

// Add marked, pdfjs, and XLSX to the window interface for TypeScript
declare global {
    interface Window {
        marked: {
            parse(markdownString: string, options?: object): string;
        };
        pdfjsLib: any;
        XLSX: any;
    }
}

interface StagedFile {
    id: string;
    file: File;
    previewUrl: string;
}

interface TranscriptionResult {
    id: string;
    fileName: string;
    markdown: string;
    error?: string;
    copied?: boolean;
}

interface ProcessingStatus {
    isProcessing: boolean;
    total: number;
    completed: number;
    currentFileName: string | null;
}

const fileToGenerativePart = async (file: File) => {
    const base64EncodedDataPromise = new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            if (typeof reader.result === 'string') {
                resolve(reader.result.split(',')[1]);
            }
        };
        reader.readAsDataURL(file);
    });

    return {
        data: await base64EncodedDataPromise,
        mimeType: file.type,
    };
};

const applyCropToFile = async (
  file: File,
  crop: Crop,
  rotation: number
): Promise<File | null> => {
  const image = new Image();
  const objectUrl = URL.createObjectURL(file);
  image.src = objectUrl;

  return new Promise((resolve, reject) => {
    image.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }
      
      const cropX = (crop.x / 100) * image.naturalWidth;
      const cropY = (crop.y / 100) * image.naturalHeight;
      const cropWidth = (crop.width / 100) * image.naturalWidth;
      const cropHeight = (crop.height / 100) * image.naturalHeight;
      
      if (rotation === 90 || rotation === 270) {
        canvas.width = cropHeight;
        canvas.height = cropWidth;
      } else {
        canvas.width = cropWidth;
        canvas.height = cropHeight;
      }

      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((rotation * Math.PI) / 180);
      ctx.drawImage(
          image,
          cropX,
          cropY,
          cropWidth,
          cropHeight,
          -cropWidth / 2,
          -cropHeight / 2,
          cropWidth,
          cropHeight
      );

      canvas.toBlob(blob => {
        URL.revokeObjectURL(objectUrl);
        if (!blob) {
          reject(new Error('Canvas is empty'));
          return;
        }
        const newFileName = `${file.name.split('.').slice(0, -1).join('.')}-cropped.png`;
        const newFile = new File([blob], newFileName, { type: 'image/png' });
        resolve(newFile);
      }, 'image/png', 1);
    };
    image.onerror = (err) => {
      URL.revokeObjectURL(objectUrl);
      reject(err);
    };
  });
};


const App: React.FC = () => {
    // Persisted settings
    const [persistedApiKey, setPersistedApiKey] = useLocalStorage<string>('gemini_api_key', '');
    const [persistedSystemPrompt, setPersistedSystemPrompt] = useLocalStorage<string>('gemini_system_prompt', DEFAULT_SYSTEM_PROMPT);
    const [persistedTemperature, setPersistedTemperature] = useLocalStorage<number>('gemini_temperature', DEFAULT_TEMPERATURE);
    const [persistedModel, setPersistedModel] = useLocalStorage<string>('gemini_model', 'gemini-flash-latest');
    const [availableModels, setAvailableModels] = useLocalStorage<string[]>('gemini_available_models', ['gemini-flash-latest']);

    // Temporary settings state for the modal
    const [tempApiKey, setTempApiKey] = useState(persistedApiKey);
    const [tempSystemPrompt, setTempSystemPrompt] = useState(persistedSystemPrompt);
    const [tempTemperature, setTempTemperature] = useState(persistedTemperature);
    const [tempModel, setTempModel] = useState(persistedModel);
    
    // App state
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([]);
    const [transcriptions, setTranscriptions] = useState<TranscriptionResult[]>([]);
    const [processingStatus, setProcessingStatus] = useState<ProcessingStatus>({ isProcessing: false, total: 0, completed: 0, currentFileName: null });
    const [error, setError] = useState<string | null>(null);
    const [isPdfModalOpen, setIsPdfModalOpen] = useState(false);
    const [currentPdfFile, setCurrentPdfFile] = useState<File | null>(null);
    const [isEditorModalOpen, setIsEditorModalOpen] = useState(false);
    const [currentFileToEdit, setCurrentFileToEdit] = useState<StagedFile | null>(null);
    const [isExportModalOpen, setIsExportModalOpen] = useState(false);
    const [isFaqOpen, setIsFaqOpen] = useState(false);
    const [collapsedResults, setCollapsedResults] = useState<Set<string>>(new Set());
    const [savedCrop, setSavedCrop] = useState<{ crop: Crop; rotation: number; sourceId: string } | null>(null);
    const [isBatchCropping, setIsBatchCropping] = useState(false);

    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        // Configure PDF.js worker
        if (window.pdfjsLib) {
            window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://unpkg.com/pdfjs-dist@4.4.168/build/pdf.worker.mjs';
        }
    }, []);

    useEffect(() => {
        // Sync temp settings when persisted ones change
        setTempApiKey(persistedApiKey);
        setTempSystemPrompt(persistedSystemPrompt);
        setTempTemperature(persistedTemperature);
        setTempModel(persistedModel);
    }, [persistedApiKey, persistedSystemPrompt, persistedTemperature, persistedModel]);
    
    // Cleanup blob URLs on unmount
    useEffect(() => {
        return () => {
            stagedFiles.forEach(sf => URL.revokeObjectURL(sf.previewUrl));
        };
    }, [stagedFiles]);

    const handleSaveSettings = () => {
        setPersistedApiKey(tempApiKey);
        setPersistedSystemPrompt(tempSystemPrompt);
        setPersistedTemperature(tempTemperature);
        setPersistedModel(tempModel);
        if (tempModel && !availableModels.includes(tempModel)) {
            setAvailableModels([...availableModels, tempModel]);
        }
        alert('Configurações salvas!');
        setSettingsOpen(false);
    };
    
    const allAvailableModels = Array.from(new Set(['gemini-flash-latest', ...availableModels]));

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = event.target.files;
        if (!files) return;

        // Fix: Explicitly type allFiles to ensure correct type inference for file properties.
        const allFiles: File[] = Array.from(files);
        const imageFiles = allFiles.filter(file => file.type.startsWith('image/'));
        const pdfFiles = allFiles.filter(file => file.type === 'application/pdf');
        
        if (pdfFiles.length > 1) {
            alert('Você selecionou múltiplos PDFs. Apenas o primeiro será processado. Por favor, envie os outros arquivos novamente após concluir a seleção de páginas do PDF atual.');
        }

        const pdfToProcess = pdfFiles.length > 0 ? pdfFiles[0] : null;

        if (imageFiles.length > 0) {
            const newImageStagedFiles = imageFiles.map(file => ({
                id: `${file.name}-${file.lastModified}-${Math.random()}`,
                file,
                previewUrl: URL.createObjectURL(file),
            }));
            setStagedFiles(prev => [...prev, ...newImageStagedFiles]);
        }

        if (pdfToProcess) {
            setCurrentPdfFile(pdfToProcess);
            setIsPdfModalOpen(true);
        }

        setTranscriptions([]);
        setError(null);

        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    const handlePdfPagesSelected = (pageFiles: File[]) => {
        const newStagedFiles = pageFiles.map(file => ({
            id: `${file.name}-${file.lastModified}-${Math.random()}`,
            file,
            previewUrl: URL.createObjectURL(file),
        }));
        setStagedFiles(prev => [...prev, ...newStagedFiles]);
        setIsPdfModalOpen(false);
        setCurrentPdfFile(null);
    };

    const handleClosePdfModal = () => {
        setIsPdfModalOpen(false);
        setCurrentPdfFile(null);
    };


    const handleRemoveFile = (idToRemove: string) => {
        const fileToRemove = stagedFiles.find(sf => sf.id === idToRemove);
        if (fileToRemove) {
            URL.revokeObjectURL(fileToRemove.previewUrl);
        }
        setStagedFiles(prev => prev.filter(sf => sf.id !== idToRemove));
    };

    const handleOpenEditor = (fileId: string) => {
        const fileToEdit = stagedFiles.find(sf => sf.id === fileId);
        if (fileToEdit) {
            setCurrentFileToEdit(fileToEdit);
            setIsEditorModalOpen(true);
        }
    };
    
    const handleCloseEditor = () => {
        setIsEditorModalOpen(false);
        setCurrentFileToEdit(null);
    };
    
    const handleImageEdited = (editedFile: File, crop: Crop, rotation: number) => {
        if (!currentFileToEdit) return;

        setSavedCrop({ crop, rotation, sourceId: currentFileToEdit.id });
    
        setStagedFiles(prev => {
            const oldFile = prev.find(sf => sf.id === currentFileToEdit.id);
            if (oldFile) {
                URL.revokeObjectURL(oldFile.previewUrl);
            }
    
            return prev.map(sf => 
                sf.id === currentFileToEdit.id 
                ? { ...sf, file: editedFile, previewUrl: URL.createObjectURL(editedFile) } 
                : sf
            );
        });
    
        handleCloseEditor();
    };

    const handleApplySavedCropToOne = async (fileId: string) => {
        if (!savedCrop) return;

        const targetFile = stagedFiles.find(sf => sf.id === fileId);
        if (!targetFile) return;

        try {
            const newFile = await applyCropToFile(targetFile.file, savedCrop.crop, savedCrop.rotation);
            if (newFile) {
                setStagedFiles(prev => {
                    const oldFile = prev.find(sf => sf.id === fileId);
                    if (oldFile) {
                        URL.revokeObjectURL(oldFile.previewUrl);
                    }
                    return prev.map(sf => 
                        sf.id === fileId 
                        ? { ...sf, file: newFile, previewUrl: URL.createObjectURL(newFile) }
                        : sf
                    );
                });
            }
        } catch (err) {
            console.error(`Failed to apply crop to ${targetFile.file.name}`, err);
            setError(`Falha ao aplicar o recorte em ${targetFile.file.name}.`);
        }
    };

    const handleApplyCropToAll = async () => {
        if (!savedCrop || stagedFiles.length < 2) return;

        setIsBatchCropping(true);
        try {
            const updates = new Map<string, { file: File, previewUrl: string }>();

            const cropPromises = stagedFiles.map(async (sf) => {
                // Apply crop only to files that are not the source
                if (sf.id !== savedCrop.sourceId) {
                    const newFile = await applyCropToFile(sf.file, savedCrop.crop, savedCrop.rotation);
                    if (newFile) {
                        updates.set(sf.id, { file: newFile, previewUrl: URL.createObjectURL(newFile) });
                    }
                }
            });

            await Promise.all(cropPromises);

            // Apply updates
            setStagedFiles(prev => {
                // Revoke old URLs that are being replaced
                prev.forEach(sf => {
                    if (updates.has(sf.id)) {
                        URL.revokeObjectURL(sf.previewUrl);
                    }
                });

                return prev.map(sf => {
                    const update = updates.get(sf.id);
                    return update ? { ...sf, ...update } : sf;
                });
            });
            
            setSavedCrop(null); // Clear saved crop

        } catch (err) {
            console.error("Batch crop failed:", err);
            setError("Ocorreu um erro ao aplicar o recorte em lote.");
        } finally {
            setIsBatchCropping(false);
        }
    };

    const toggleCollapse = (id: string) => {
        setCollapsedResults(prev => {
            const newSet = new Set(prev);
            if (newSet.has(id)) {
                newSet.delete(id);
            } else {
                newSet.add(id);
            }
            return newSet;
        });
    };

    const handlePasteFromClipboard = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!navigator.clipboard?.read) {
            setError('Seu navegador não suporta colar da área de transferência. Por favor, utilize um navegador moderno como Chrome, Edge ou Firefox.');
            return;
        }

        try {
            const clipboardItems = await navigator.clipboard.read();
            let imageFile: File | null = null;

            for (const item of clipboardItems) {
                const imageType = item.types.find(type => type.startsWith('image/'));
                if (imageType) {
                    const blob = await item.getType(imageType);
                    const file = new File([blob], `colado-${Date.now()}.png`, { type: blob.type });
                    imageFile = file;
                    break;
                }
            }

            if (imageFile) {
                const newStagedFile = {
                    id: `${imageFile.name}-${imageFile.lastModified}-${Math.random()}`,
                    file: imageFile,
                    previewUrl: URL.createObjectURL(imageFile),
                };
                setStagedFiles(prev => [...prev, newStagedFile]);
                setTranscriptions([]);
                setError(null);
            } else {
                setError('Nenhuma imagem encontrada na área de transferência.');
            }
        } catch (err) {
            console.error('Falha ao colar da área de transferência:', err);
            let message = 'Ocorreu um erro desconhecido. Verifique o console para mais detalhes.';
            if (err instanceof Error) {
                if (err.name === 'NotAllowedError') {
                    message = 'A permissão para acessar a área de transferência foi negada. Por favor, permita o acesso nas configurações do seu navegador.';
                } else {
                    message = `Erro ao colar: ${err.message}. Verifique se o seu navegador tem permissão para acessar a área de transferência.`;
                }
            }
            setError(message);
        }
    };

    const handleTranscribe = useCallback(async () => {
        if (stagedFiles.length === 0) {
            setError('Por favor, selecione ao menos um arquivo de imagem.');
            return;
        }

        if (!persistedApiKey) {
            setError('Por favor, configure sua chave de API do Gemini na seção de Configuração.');
            setSettingsOpen(true);
            return;
        }
        
        setProcessingStatus({ isProcessing: true, total: stagedFiles.length, completed: 0, currentFileName: null });
        setError(null);
        setTranscriptions([]);

        for (const stagedFile of stagedFiles) {
             setProcessingStatus(prev => ({ ...prev, currentFileName: stagedFile.file.name }));
            try {
                const imagePart = await fileToGenerativePart(stagedFile.file);
                const result = await transcribeImage({
                    apiKey: persistedApiKey,
                    systemPrompt: persistedSystemPrompt,
                    temperature: persistedTemperature,
                    model: persistedModel,
                    image: imagePart,
                });
                const cleanMarkdown = result.replace(/^(```(?:markdown)?\s*)|(\s*```)$/g, '').trim();
                setTranscriptions(prev => [...prev, { id: stagedFile.id, fileName: stagedFile.file.name, markdown: cleanMarkdown }]);
            } catch (e) {
                console.error(e);
                const errorMessage = e instanceof Error ? e.message : 'Ocorreu um erro desconhecido.';
                setTranscriptions(prev => [...prev, { id: stagedFile.id, fileName: stagedFile.file.name, markdown: '', error: errorMessage }]);
            } finally {
                setProcessingStatus(prev => ({ ...prev, completed: prev.completed + 1 }));
            }
        }

        setProcessingStatus({ isProcessing: false, total: stagedFiles.length, completed: stagedFiles.length, currentFileName: null });
        setStagedFiles([]); // Clear the queue after processing
    }, [stagedFiles, persistedApiKey, persistedSystemPrompt, persistedTemperature, persistedModel]);

    const handleCopy = (id: string) => {
        const transcriptionToCopy = transcriptions.find(t => t.id === id);
        if (!transcriptionToCopy || transcriptionToCopy.copied) return;
        
        navigator.clipboard.writeText(transcriptionToCopy.markdown);
        
        setTranscriptions(prev => prev.map(t => t.id === id ? { ...t, copied: true } : t));
        setTimeout(() => {
             setTranscriptions(prev => prev.map(t => t.id === id ? { ...t, copied: false } : t));
        }, 2000);
    };
    
    const downloadBlob = (blob: Blob, fileName: string) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const handleExport = (format: ExportFormat) => {
        if (transcriptions.length === 0) return;

        const validTranscriptions = transcriptions.filter(t => !t.error);

        if (format === 'md') {
            const combinedMarkdown = validTranscriptions
                .map(t => `## Transcrição para: ${t.fileName}\n\n${t.markdown}`)
                .join('\n\n---\n\n');
            const blob = new Blob([combinedMarkdown], { type: 'text/markdown' });
            downloadBlob(blob, 'transcricoes.md');
        } else if (format === 'csv') {
             const parseMarkdownTable = (markdown: string): string[][] => {
                const lines = markdown.trim().split('\n');
                return lines
                    .filter(line => line.includes('|') && !line.match(/^[| -]+$/))
                    .map(row => row.split('|').slice(1, -1).map(cell => cell.trim()));
            };

            const csvRows: string[] = [];
            validTranscriptions.forEach(t => {
                csvRows.push(`"Transcrição para: ${t.fileName}"`);
                const tableData = parseMarkdownTable(t.markdown);
                tableData.forEach(row => {
                    csvRows.push(row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(','));
                });
                csvRows.push(''); // Blank separator row
            });
            const csvContent = csvRows.join('\n');
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            downloadBlob(blob, 'transcricoes.csv');
        } else if (format === 'xlsx') {
            if (!window.XLSX) {
                alert('Erro: A biblioteca de exportação para Excel (XLSX) não foi carregada.');
                setIsExportModalOpen(false);
                return;
            }

            const parseMarkdownTable = (markdown: string): string[][] => {
                const lines = markdown.trim().split('\n');
                return lines
                    .filter(line => line.includes('|') && !line.match(/^[| -]+$/))
                    .map(row => row.split('|').slice(1, -1).map(cell => cell.trim()));
            };

            const wb = window.XLSX.utils.book_new();
            validTranscriptions.forEach(t => {
                const tableData = parseMarkdownTable(t.markdown);
                if (tableData.length > 0) {
                    const ws = window.XLSX.utils.aoa_to_sheet(tableData);
                    const sheetName = t.fileName.replace(/[\\\/\*\?:"<>|]/g, '').substring(0, 31);
                    window.XLSX.utils.book_append_sheet(wb, ws, sheetName);
                }
            });
            window.XLSX.writeFile(wb, 'transcricoes.xlsx');
        }

        setIsExportModalOpen(false);
    };

    const renderTranscriptionResult = (result: TranscriptionResult) => {
        if (result.error) {
            return <p className="text-red-700 bg-red-100 p-3 rounded-md text-sm">Falha ao transcrever: {result.error}</p>;
        }
        if (typeof window.marked?.parse !== 'function') {
            return <pre className="whitespace-pre-wrap break-all text-gray-800">{result.markdown}</pre>;
        }
        const html = window.marked.parse(result.markdown, { gfm: true, breaks: true });
        return (
            <div 
                className="prose prose-sm max-w-none prose-table:border prose-table:border-collapse prose-th:border prose-td:border prose-th:border-gray-300 prose-td:border-gray-300 prose-td:p-2 prose-th:p-2 prose-p:text-gray-900 prose-td:text-gray-900 prose-th:text-gray-900"
                dangerouslySetInnerHTML={{ __html: html }} 
            />
        );
    };

    return (
        <div className="bg-[#f9f9f9] text-[#1B5E20] min-h-screen font-sans flex flex-col">
            <main className="max-w-4xl mx-auto p-4 md:p-8 w-full flex-grow">
                <header className="text-center mb-8">
                    <h1 className="text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-[#1B5E20] to-[#69AD49]">
                        Transcritor de Cartão de Ponto com IA
                    </h1>
                    <div className="mt-4 text-gray-600 max-w-3xl mx-auto text-left md:text-center space-y-1">
                        <p><strong>1. Envie:</strong> Arraste imagens (JPG, PNG) ou PDFs dos seus cartões de ponto.</p>
                        <p><strong>2. Edite e Transcreva:</strong> Ajuste as imagens se necessário e clique para extrair os dados com precisão.</p>
                        <p><strong>3. Exporte:</strong> Salve os resultados em Markdown, CSV ou Excel (.xlsx).</p>
                    </div>

                    <div className="mt-6">
                        <button 
                            onClick={() => setIsFaqOpen(!isFaqOpen)}
                            className="inline-flex items-center gap-2 text-sm font-semibold text-[#1B5E20] hover:text-[#69AD49] transition-colors"
                        >
                            <span>Dúvidas? Veja o guia rápido</span>
                            <ChevronDownIcon className={`w-4 h-4 transition-transform ${isFaqOpen ? 'rotate-180' : ''}`} />
                        </button>
                    </div>

                    {isFaqOpen && (
                        <div className="mt-4 max-w-4xl mx-auto bg-white p-6 rounded-lg border border-gray-200 shadow-sm text-left">
                            <h3 className="text-lg font-bold text-gray-800 mb-4">Guia Rápido e Perguntas Frequentes</h3>
                            <div className="space-y-4 prose prose-sm max-w-none">
                                <details>
                                    <summary className="font-semibold cursor-pointer text-gray-700">Posso enviar múltiplos arquivos de uma vez?</summary>
                                    <p className="mt-2 text-gray-600">
                                        Sim! Você pode selecionar várias imagens e PDFs ao mesmo tempo. Para arquivos PDF com várias páginas, um painel aparecerá para você selecionar individualmente quais páginas deseja adicionar à fila.
                                        <br/><strong>Atenção:</strong> só é possível processar um arquivo PDF por vez. Se selecionar vários, apenas o primeiro será aberto.
                                    </p>
                                </details>
                                <hr className="my-2"/>
                                <details>
                                    <summary className="font-semibold cursor-pointer text-gray-700">Como posso corrigir uma imagem antes de transcrever?</summary>
                                    <p className="mt-2 text-gray-600">
                                        Na fila de upload, cada imagem possui um ícone de 'Cortar'. Ao clicar nele, você abrirá um editor que permite cortar e girar a imagem. Isso é útil para isolar apenas a tabela de ponto e remover cabeçalhos ou rodapés, garantindo uma transcrição mais precisa.
                                    </p>
                                </details>
                                <hr className="my-2"/>
                                <details>
                                    <summary className="font-semibold cursor-pointer text-gray-700">Como funciona o recorte em lote?</summary>
                                    <p className="mt-2 text-gray-600">
                                        Ao cortar uma imagem da fila, esse recorte é salvo como um modelo. Em seguida, um botão "Aplicar em Todos" aparecerá, permitindo que você aplique o mesmo recorte a todas as outras imagens na fila com um único clique. Isso economiza muito tempo se você tiver várias digitalizações com o mesmo layout.
                                    </p>
                                </details>
                                <hr className="my-2"/>
                                <details>
                                    <summary className="font-semibold cursor-pointer text-gray-700">Quais são os formatos de exportação disponíveis?</summary>
                                    <p className="mt-2 text-gray-600">
                                        Após a transcrição, clique em "Exportar Tudo". Você poderá escolher entre:
                                        <ul>
                                            <li><strong>Markdown (.md):</strong> Ideal para documentação e texto simples.</li>
                                            <li><strong>CSV:</strong> Perfeito para importação em planilhas (Google Sheets, etc.) ou bancos de dados.</li>
                                            <li><strong>Excel (.xlsx):</strong> A melhor opção para análise de dados, organizando cada transcrição em uma aba separada dentro do mesmo arquivo.</li>
                                        </ul>
                                    </p>
                                </details>
                                 <hr className="my-2"/>
                                <details>
                                    <summary className="font-semibold cursor-pointer text-gray-700">Onde configuro minha chave de API?</summary>
                                    <p className="mt-2 text-gray-600">
                                        Você precisa configurar sua própria chave de API do Gemini para usar esta aplicação. Abra a seção "Configuração" abaixo, cole sua chave de API no campo correspondente e clique em "Salvar Configurações". A chave será salva localmente no seu navegador para uso futuro.
                                    </p>
                                    <p className="mt-2 text-gray-600">
                                        Você pode criar sua chave de API gratuitamente no <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="text-[#69AD49] hover:underline font-medium">Google AI Studio</a>. A cobrança pelo uso da API é feita diretamente pelo Google, e muitos modelos oferecem um generoso nível de uso gratuito.
                                    </p>
                                </details>
                            </div>
                        </div>
                    )}
                </header>

                <Settings 
                    isOpen={settingsOpen}
                    toggle={() => setSettingsOpen(!settingsOpen)}
                    apiKey={tempApiKey}
                    setApiKey={setTempApiKey}
                    systemPrompt={tempSystemPrompt}
                    setSystemPrompt={setTempSystemPrompt}
                    temperature={tempTemperature}
                    setTemperature={setTempTemperature}
                    model={tempModel}
                    setModel={setTempModel}
                    availableModels={allAvailableModels}
                    onSave={handleSaveSettings}
                />

                <div className="space-y-8">
                    {/* Upload Section */}
                    <div className="flex flex-col space-y-4">
                        <h2 className="text-xl font-semibold text-gray-800">1. Fila de Upload</h2>
                        <div 
                            className="relative border-2 border-dashed border-gray-300 rounded-lg p-6 text-center bg-white"
                        >
                             <input
                                type="file"
                                accept="image/*,application/pdf"
                                ref={fileInputRef}
                                onChange={handleFileChange}
                                className="hidden"
                                multiple
                            />
                            <div 
                                className="text-gray-500 cursor-pointer hover:text-[#69AD49] transition-colors"
                                onClick={() => fileInputRef.current?.click()}
                            >
                                <UploadIcon className="w-12 h-12 mx-auto mb-2" />
                                <p>Clique para selecionar arquivos</p>
                                <p className="text-sm">Você pode selecionar imagens e PDFs</p>
                            </div>
                             <div className="my-4 relative">
                                <div className="absolute inset-0 flex items-center" aria-hidden="true">
                                    <div className="w-full border-t border-gray-200" />
                                </div>
                                <div className="relative flex justify-center">
                                    <span className="bg-white px-2 text-sm text-gray-500">ou</span>
                                </div>
                            </div>
                             <button
                                onClick={handlePasteFromClipboard}
                                className="inline-flex items-center justify-center gap-2 px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#69AD49] transition-colors"
                            >
                                <ClipboardIcon className="w-5 h-5 text-gray-500" />
                                Colar da área de transferência
                            </button>
                        </div>

                        {stagedFiles.length > 0 && (
                             <>
                                {savedCrop && stagedFiles.length > 1 && (
                                    <div className="my-2 p-3 bg-green-50 border border-green-200 rounded-lg flex items-center justify-between animate-fade-in">
                                        <div className="flex items-center gap-2">
                                            <SparklesIcon className="w-5 h-5 text-green-700"/>
                                            <span className="text-sm font-medium text-green-800">Recorte salvo pronto para ser aplicado.</span>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <button
                                                onClick={() => setSavedCrop(null)}
                                                className="text-xs font-medium text-gray-600 hover:text-gray-900"
                                                title="Limpar recorte salvo"
                                            >
                                                Limpar
                                            </button>
                                            <button
                                                onClick={handleApplyCropToAll}
                                                disabled={isBatchCropping}
                                                className="px-3 py-1.5 text-sm bg-[#1B5E20] text-white font-semibold rounded-md hover:bg-opacity-90 disabled:bg-gray-300 transition-colors flex items-center"
                                            >
                                                 {isBatchCropping && <svg className="animate-spin -ml-1 mr-2 h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="http://www.w3.org/2000/svg"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>}
                                                {isBatchCropping ? 'Aplicando...' : 'Aplicar em Todos'}
                                            </button>
                                        </div>
                                    </div>
                                )}
                                <div className="space-y-3 bg-white p-3 rounded-lg border border-gray-200 max-h-80 overflow-y-auto">
                                    {stagedFiles.map((sf) => (
                                        <div key={sf.id} className="flex items-center justify-between p-2 bg-gray-50 rounded-md">
                                            <div className="flex items-center gap-3 overflow-hidden">
                                                <img src={sf.previewUrl} alt="Preview" className="w-12 h-12 object-cover rounded-md flex-shrink-0"/>
                                                <span className="text-sm text-gray-700 truncate" title={sf.file.name}>{sf.file.name}</span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                {savedCrop && sf.id !== savedCrop.sourceId && (
                                                    <button
                                                        onClick={() => handleApplySavedCropToOne(sf.id)}
                                                        className="text-gray-400 hover:text-green-600 transition-colors p-1"
                                                        title="Reaproveitar Recorte"
                                                    >
                                                        <SparklesIcon className="w-5 h-5" />
                                                    </button>
                                                )}
                                                <button onClick={() => handleOpenEditor(sf.id)} className="text-gray-400 hover:text-blue-600 transition-colors p-1" title="Cortar/Girar Imagem">
                                                    <CropIcon className="w-5 h-5"/>
                                                </button>
                                                <button onClick={() => handleRemoveFile(sf.id)} className="text-gray-400 hover:text-red-600 transition-colors p-1" title="Remover Arquivo">
                                                    <XCircleIcon className="w-6 h-6"/>
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </>
                        )}
                        
                        <button
                            onClick={handleTranscribe}
                            disabled={stagedFiles.length === 0 || processingStatus.isProcessing || isBatchCropping}
                            className="w-full bg-[#69AD49] text-white font-bold py-3 px-4 rounded-md hover:bg-[#5a9a3f] disabled:bg-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
                        >
                             {processingStatus.isProcessing && <svg className="animate-spin -ml-1 mr-3 h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="http://www.w3.org/2000/svg">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                              </svg>}
                            {processingStatus.isProcessing 
                                ? `Transcrevendo ${processingStatus.completed + 1} de ${processingStatus.total}...`
                                : `Transcrever ${stagedFiles.length} item(ns)`
                            }
                        </button>
                    </div>

                    {/* Results Section */}
                    <div className="flex flex-col space-y-4">
                         <div className="flex justify-between items-center">
                            <h2 className="text-xl font-semibold text-gray-800">2. Resultados</h2>
                             {transcriptions.length > 0 && !processingStatus.isProcessing && (
                                <button onClick={() => setIsExportModalOpen(true)} title="Exportar Tudo" className="px-4 py-2 text-sm bg-[#1B5E20] text-white font-semibold rounded-md hover:bg-opacity-90 transition-colors">
                                    Exportar Tudo
                                </button>
                            )}
                        </div>
                        <div className="space-y-4">
                            {processingStatus.isProcessing && transcriptions.length === 0 && (
                                <div className="bg-white rounded-lg p-4 min-h-[200px] border border-gray-200 shadow-inner">
                                    <SkeletonLoader />
                                </div>
                            )}
                            {error && <p className="text-red-700 bg-red-100 p-3 rounded-md text-sm">{error}</p>}
                            {!processingStatus.isProcessing && transcriptions.length === 0 && (
                                 <div className="bg-white rounded-lg p-4 min-h-[200px] border border-gray-200 shadow-inner text-gray-400 h-full flex items-center justify-center">
                                    Os resultados aparecerão aqui.
                                </div>
                            )}
                            {transcriptions.map(result => {
                                const isCollapsed = collapsedResults.has(result.id);
                                return (
                                <div key={result.id} className="bg-white rounded-lg p-4 border border-gray-200 shadow-sm">
                                    <div className="flex justify-between items-center pb-2 border-b">
                                        <h3 className="font-semibold text-gray-700 truncate" title={result.fileName}>{result.fileName}</h3>
                                        <div className="flex items-center gap-2">
                                            {!result.error && (
                                                <button onClick={() => handleCopy(result.id)} title="Copiar Transcrição" className="text-[#69AD49] hover:text-[#1B5E20] transition-colors p-1 rounded-md">
                                                    {result.copied ? <CheckIcon className="w-5 h-5"/> : <CopyIcon className="w-5 h-5"/>}
                                                </button>
                                            )}
                                            <button onClick={() => toggleCollapse(result.id)} title={isCollapsed ? "Expandir" : "Minimizar"} className="text-gray-500 hover:text-gray-800 transition-colors p-1 rounded-md">
                                                <ChevronDownIcon className={`w-5 h-5 transition-transform ${isCollapsed ? '' : 'rotate-180'}`} />
                                            </button>
                                        </div>
                                    </div>
                                    {!isCollapsed && (
                                        <div className="pt-2">
                                            {renderTranscriptionResult(result)}
                                        </div>
                                    )}
                                </div>
                            )})}
                             {processingStatus.isProcessing && processingStatus.completed < processingStatus.total && (
                                <div className="bg-white rounded-lg p-4 border border-gray-200 shadow-sm opacity-60">
                                    <p className="text-gray-600 mb-4">Aguardando transcrição para os arquivos restantes...</p>
                                    <SkeletonLoader />
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {isPdfModalOpen && currentPdfFile && (
                    <PdfSelectionModal 
                        isOpen={isPdfModalOpen}
                        pdfFile={currentPdfFile}
                        onClose={handleClosePdfModal}
                        onConfirm={handlePdfPagesSelected}
                    />
                )}

                {isEditorModalOpen && currentFileToEdit && (
                    <ImageEditorModal
                        isOpen={isEditorModalOpen}
                        imageFile={currentFileToEdit.file}
                        onClose={handleCloseEditor}
                        onConfirm={handleImageEdited}
                    />
                )}
                
                <ExportModal
                    isOpen={isExportModalOpen}
                    onClose={() => setIsExportModalOpen(false)}
                    onExport={handleExport}
                />
            </main>
        </div>
    );
};

export default App;