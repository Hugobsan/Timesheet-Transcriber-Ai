import React, { useState, useEffect, useCallback } from 'react';
import { XMarkIcon } from './icons';
import * as pdfjsLib from 'pdfjs-dist/build/pdf.mjs';

interface PdfSelectionModalProps {
    isOpen: boolean;
    pdfFile: File;
    onClose: () => void;
    onConfirm: (imageFiles: File[]) => void;
}

const dataUrlToFile = async (dataUrl: string, fileName: string): Promise<File> => {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    return new File([blob], fileName, { type: blob.type });
};

export const PdfSelectionModal: React.FC<PdfSelectionModalProps> = ({
    isOpen,
    pdfFile,
    onClose,
    onConfirm
}) => {
    const [pagePreviews, setPagePreviews] = useState<string[]>([]);
    const [selectedPages, setSelectedPages] = useState<Set<number>>(new Set());
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const togglePageSelection = (pageNumber: number) => {
        setSelectedPages(prev => {
            const newSelection = new Set(prev);
            if (newSelection.has(pageNumber)) {
                newSelection.delete(pageNumber);
            } else {
                newSelection.add(pageNumber);
            }
            return newSelection;
        });
    };

    const handleSelectAll = () => {
        const allSelected = pagePreviews.length > 0 && selectedPages.size === pagePreviews.length;
        if (allSelected) {
            setSelectedPages(new Set());
        } else {
            const allPageNumbers = new Set(Array.from({ length: pagePreviews.length }, (_, i) => i + 1));
            setSelectedPages(allPageNumbers);
        }
    };

    const handleConfirm = useCallback(async () => {
        if (selectedPages.size === 0) return;
        setIsLoading(true);
        try {
            const filePromises = Array.from(selectedPages).map(pageNumber => {
                // Fix: Explicitly cast pageNumber to a number before arithmetic operation to resolve a TypeScript type error.
                const previewUrl = pagePreviews[Number(pageNumber) - 1];
                const fileName = `${pdfFile.name.replace('.pdf', '')}-page-${pageNumber}.png`;
                return dataUrlToFile(previewUrl, fileName);
            });
            const files = await Promise.all(filePromises);
            onConfirm(files);
        } catch (e) {
            setError('Falha ao converter páginas para imagens.');
            console.error(e);
        } finally {
            setIsLoading(false);
        }
    }, [selectedPages, pagePreviews, onConfirm, pdfFile.name]);

    useEffect(() => {
        if (!isOpen || !pdfFile) return;

        const loadPdf = async () => {
            setIsLoading(true);
            setError(null);
            setPagePreviews([]);
            setSelectedPages(new Set());

            try {
                const arrayBuffer = await pdfFile.arrayBuffer();
                const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
                const numPages = pdf.numPages;
                const previews: string[] = [];
                
                for (let i = 1; i <= numPages; i++) {
                    const page = await pdf.getPage(i);
                    const viewport = page.getViewport({ scale: 1.5 });
                    const canvas = document.createElement('canvas');
                    const context = canvas.getContext('2d');
                    canvas.height = viewport.height;
                    canvas.width = viewport.width;

                    if (context) {
                        await page.render({ canvasContext: context, viewport: viewport }).promise;
                        previews.push(canvas.toDataURL('image/png'));
                    }
                }
                setPagePreviews(previews);
            } catch (e) {
                console.error('Failed to load PDF:', e);
                setError('Não foi possível carregar o arquivo PDF. Verifique se o arquivo está corrompido.');
            } finally {
                setIsLoading(false);
            }
        };

        loadPdf();
    }, [isOpen, pdfFile]);

    if (!isOpen) return null;

    const allSelected = pagePreviews.length > 0 && selectedPages.size === pagePreviews.length;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 z-50 flex items-center justify-center p-4" aria-modal="true" role="dialog">
            <div className="bg-white rounded-lg shadow-2xl w-full max-w-4xl h-[90vh] flex flex-col">
                <header className="flex items-center justify-between p-4 border-b border-gray-200 flex-shrink-0">
                    <h2 className="text-xl font-semibold text-gray-800">Selecione as Páginas</h2>
                    <button onClick={onClose} className="p-1 text-gray-500 hover:text-gray-800 rounded-full focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#69AD49]">
                        <XMarkIcon className="w-6 h-6" />
                    </button>
                </header>

                <main className="flex-grow p-6 overflow-y-auto">
                    {isLoading && !error && pagePreviews.length === 0 && (
                         <div className="flex flex-col items-center justify-center h-full text-gray-500">
                            <svg className="animate-spin h-8 w-8 mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="http://www.w3.org/2000/svg">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            Processando PDF...
                        </div>
                    )}
                    {error && <p className="text-red-600 bg-red-100 p-4 rounded-md text-center">{error}</p>}
                    {!isLoading && !error && (
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                            {pagePreviews.map((previewUrl, index) => {
                                const pageNumber = index + 1;
                                const isSelected = selectedPages.has(pageNumber);
                                return (
                                    <div 
                                        key={pageNumber} 
                                        onClick={() => togglePageSelection(pageNumber)}
                                        className={`relative border-2 rounded-lg overflow-hidden cursor-pointer transition-all duration-200 ${isSelected ? 'border-[#69AD49] ring-2 ring-[#69AD49]' : 'border-gray-200 hover:border-gray-400'}`}
                                    >
                                        <img src={previewUrl} alt={`Página ${pageNumber}`} className="w-full h-auto" />
                                        <div className="absolute top-1 right-1 bg-white rounded-full p-0.5">
                                            <input 
                                                type="checkbox" 
                                                checked={isSelected}
                                                readOnly
                                                className="h-5 w-5 rounded text-[#69AD49] focus:ring-[#5a9a3f]"
                                            />
                                        </div>
                                        <div className="absolute bottom-0 left-0 right-0 bg-black bg-opacity-50 text-white text-xs text-center py-0.5">
                                            Página {pageNumber}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </main>
                
                <footer className="flex items-center justify-between p-4 border-t border-gray-200 bg-gray-50 flex-shrink-0">
                    <div>
                        {pagePreviews.length > 0 && !isLoading && !error && (
                            <button
                                onClick={handleSelectAll}
                                className="px-4 py-2 text-sm font-semibold text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
                            >
                                {allSelected ? 'Desmarcar Todas' : 'Selecionar Todas'}
                            </button>
                        )}
                    </div>
                    <div className="flex items-center">
                        <button onClick={onClose} className="px-4 py-2 text-gray-700 font-semibold rounded-md hover:bg-gray-200 transition-colors mr-3">
                            Cancelar
                        </button>
                        <button 
                            onClick={handleConfirm}
                            disabled={selectedPages.size === 0 || isLoading}
                            className="px-5 py-2 bg-[#69AD49] text-white font-semibold rounded-md hover:bg-[#5a9a3f] disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                        >
                            {isLoading ? 'Adicionando...' : `Adicionar ${selectedPages.size} Página(s)`}
                        </button>
                    </div>
                </footer>
            </div>
        </div>
    );
};