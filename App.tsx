import React, { useState, useCallback, useEffect, useRef } from 'react';
import useLocalStorage from './hooks/useLocalStorage';
import { DEFAULT_SYSTEM_PROMPT, DEFAULT_TEMPERATURE } from './constants';
import { transcribeImage } from './services/geminiService';
import { Settings } from './components/Settings';
import { SkeletonLoader } from './components/Spinner';
import { UploadIcon, CopyIcon, CheckIcon, XCircleIcon, CropIcon, ChevronDownIcon } from './components/icons';
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

const App: React.FC = () => {
    // Persisted settings
    const [apiKey, setApiKey] = useLocalStorage<string>('gemini_api_key', '');
    const [persistedSystemPrompt, setPersistedSystemPrompt] = useLocalStorage<string>('gemini_system_prompt', DEFAULT_SYSTEM_PROMPT);
    const [persistedTemperature, setPersistedTemperature] = useLocalStorage<number>('gemini_temperature', DEFAULT_TEMPERATURE);
    const [persistedModel, setPersistedModel] = useLocalStorage<string>('gemini_model', 'gemini-flash-latest');
    const [availableModels, setAvailableModels] = useLocalStorage<string[]>('gemini_available_models', ['gemini-flash-latest']);

    // Temporary settings state for the modal
    const [tempApiKey, setTempApiKey] = useState(apiKey);
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

    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        // Configure PDF.js worker
        if (window.pdfjsLib) {
            window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://unpkg.com/pdfjs-dist@4.4.168/build/pdf.worker.mjs';
        }
    }, []);

    useEffect(() => {
        // Sync temp settings when persisted ones change
        setTempApiKey(apiKey);
        setTempSystemPrompt(persistedSystemPrompt);
        setTempTemperature(persistedTemperature);
        setTempModel(persistedModel);
    }, [apiKey, persistedSystemPrompt, persistedTemperature, persistedModel]);
    
    // Cleanup blob URLs on unmount
    useEffect(() => {
        return () => {
            stagedFiles.forEach(sf => URL.revokeObjectURL(sf.previewUrl));
        };
    }, [stagedFiles]);

    const handleSaveSettings = () => {
        setApiKey(tempApiKey);
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

        const allFiles = Array.from(files);
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
    
    const handleImageEdited = (editedFile: File) => {
        if (!currentFileToEdit) return;
    
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

    const handleTranscribe = useCallback(async () => {
        if (stagedFiles.length === 0) {
            setError('Por favor, selecione ao menos um arquivo de imagem.');
            return;
        }
        if (!apiKey) {
            setError('Por favor, configure sua chave da API Gemini nas configurações.');
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
                    apiKey: apiKey,
                    systemPrompt: persistedSystemPrompt,
                    temperature: persistedTemperature,
                    model: persistedModel,
                    image: imagePart,
                });
                const cleanMarkdown = result.replace(/^```markdown\s*|```\s*|\s*```$/g, '');
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
    }, [stagedFiles, apiKey, persistedSystemPrompt, persistedTemperature, persistedModel]);

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
                    const sheetName = t.fileName.replace(/[\\/*?:"<>|]/g, '').substring(0, 31);
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
            <main className="max-w-7xl mx-auto p-4 md:p-8 w-full flex-grow">
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
                                        Clique no painel "Configuração". Lá você poderá inserir sua chave de API do Gemini, alterar o modelo de IA, ajustar o prompt do sistema e a "temperatura" para controlar a criatividade da resposta. Lembre-se de salvar suas configurações.
                                    </p>
                                    <p className="mt-2 text-gray-600">
                                        Você pode criar sua chave de API no <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="text-[#69AD49] hover:underline font-medium">Google AI Studio</a>. A cobrança é feita diretamente pelo Google, e muitos modelos oferecem um nível de uso gratuito.
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

                <div className="grid lg:grid-cols-2 gap-8">
                    {/* Upload Column */}
                    <div className="flex flex-col space-y-4">
                        <h2 className="text-xl font-semibold text-gray-800">1. Fila de Upload</h2>
                        <div 
                            className="relative border-2 border-dashed border-gray-300 rounded-lg p-6 text-center cursor-pointer hover:border-[#69AD49] transition-colors bg-white"
                            onClick={() => fileInputRef.current?.click()}
                        >
                             <input
                                type="file"
                                accept="image/*,application/pdf"
                                ref={fileInputRef}
                                onChange={handleFileChange}
                                className="hidden"
                                multiple
                            />
                            <div className="text-gray-500">
                                <UploadIcon className="w-12 h-12 mx-auto mb-2" />
                                <p>Clique para selecionar arquivos</p>
                                <p className="text-sm">Você pode selecionar imagens e PDFs</p>
                            </div>
                        </div>

                        {stagedFiles.length > 0 && (
                            <div className="space-y-3 bg-white p-3 rounded-lg border border-gray-200 max-h-80 overflow-y-auto">
                                {stagedFiles.map((sf) => (
                                    <div key={sf.id} className="flex items-center justify-between p-2 bg-gray-50 rounded-md">
                                        <div className="flex items-center gap-3 overflow-hidden">
                                            <img src={sf.previewUrl} alt="Preview" className="w-12 h-12 object-cover rounded-md flex-shrink-0"/>
                                            <span className="text-sm text-gray-700 truncate" title={sf.file.name}>{sf.file.name}</span>
                                        </div>
                                        <div className="flex items-center gap-2">
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
                        )}
                        
                        <button
                            onClick={handleTranscribe}
                            disabled={stagedFiles.length === 0 || processingStatus.isProcessing}
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

                    {/* Results Column */}
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
                            {transcriptions.map(result => (
                                <div key={result.id} className="bg-white rounded-lg p-4 border border-gray-200 shadow-sm">
                                    <div className="flex justify-between items-center mb-2 pb-2 border-b">
                                        <h3 className="font-semibold text-gray-700 truncate" title={result.fileName}>{result.fileName}</h3>
                                        {!result.error && (
                                            <button onClick={() => handleCopy(result.id)} title="Copiar Transcrição" className="text-[#69AD49] hover:text-[#1B5E20] transition-colors p-1 rounded-md">
                                                {result.copied ? <CheckIcon className="w-5 h-5"/> : <CopyIcon className="w-5 h-5"/>}
                                            </button>
                                        )}
                                    </div>
                                    {renderTranscriptionResult(result)}
                                </div>
                            ))}
                             {processingStatus.isProcessing && processingStatus.completed < processingStatus.total && (
                                <div className="bg-white rounded-lg p-4 border border-gray-200 shadow-sm opacity-60">
                                    <p className="text-gray-600 mb-4">Transcrevendo: <span className="font-medium">{processingStatus.currentFileName}</span>...</p>
                                    <SkeletonLoader />
                                 </div>
                             )}
                        </div>
                    </div>
                </div>
            </main>
            <footer className="text-center py-4 border-t border-gray-200 bg-white">
                <p className="text-sm text-gray-500">
                    Criado por <a href="https://github.com/Hugobsan/" target="_blank" rel="noopener noreferrer" className="font-semibold text-[#1B5E20] hover:text-[#69AD49] transition-colors">Hugo Barbosa</a>
                </p>
            </footer>
             {isPdfModalOpen && currentPdfFile && (
                <PdfSelectionModal
                    isOpen={isPdfModalOpen}
                    onClose={handleClosePdfModal}
                    onConfirm={handlePdfPagesSelected}
                    pdfFile={currentPdfFile}
                />
            )}
            {isEditorModalOpen && currentFileToEdit && (
                <ImageEditorModal
                    isOpen={isEditorModalOpen}
                    onClose={handleCloseEditor}
                    onConfirm={handleImageEdited}
                    imageFile={currentFileToEdit.file}
                />
            )}
            {isExportModalOpen && (
                <ExportModal
                    isOpen={isExportModalOpen}
                    onClose={() => setIsExportModalOpen(false)}
                    onExport={handleExport}
                />
            )}
        </div>
    );
};

export default App;
