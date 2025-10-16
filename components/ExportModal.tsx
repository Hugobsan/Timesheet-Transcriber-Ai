import React from 'react';
import { XMarkIcon, DocumentTextIcon, TableCellsIcon } from './icons';

export type ExportFormat = 'md' | 'csv' | 'xlsx';

interface ExportModalProps {
    isOpen: boolean;
    onClose: () => void;
    onExport: (format: ExportFormat) => void;
}

const exportOptions = [
    {
        format: 'md' as ExportFormat,
        title: 'Markdown',
        description: 'Ideal para documentação. Exporta um único arquivo .md com todas as transcrições.',
        icon: <DocumentTextIcon className="w-10 h-10 mb-3 text-[#1B5E20]" />
    },
    {
        format: 'csv' as ExportFormat,
        title: 'CSV',
        description: 'Perfeito para importação em planilhas ou bancos de dados. Gera um arquivo .csv unificado.',
        icon: <TableCellsIcon className="w-10 h-10 mb-3 text-[#1B5E20]" />
    },
    {
        format: 'xlsx' as ExportFormat,
        title: 'Excel (XLSX)',
        description: 'Melhor para análise. Cria um arquivo onde cada transcrição ocupa sua própria aba.',
        icon: <TableCellsIcon className="w-10 h-10 mb-3 text-[#1B5E20]" />
    }
];

export const ExportModal: React.FC<ExportModalProps> = ({ isOpen, onClose, onExport }) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 z-50 flex items-center justify-center p-4" aria-modal="true" role="dialog">
            <div className="bg-white rounded-lg shadow-2xl w-full max-w-3xl">
                <header className="flex items-center justify-between p-4 border-b border-gray-200">
                    <h2 className="text-xl font-semibold text-gray-800">Escolha o Formato de Exportação</h2>
                    <button onClick={onClose} className="p-1 text-gray-500 hover:text-gray-800 rounded-full focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#69AD49]">
                        <XMarkIcon className="w-6 h-6" />
                    </button>
                </header>

                <main className="p-6">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {exportOptions.map(option => (
                            <button
                                key={option.format}
                                onClick={() => onExport(option.format)}
                                className="p-6 border border-gray-200 rounded-lg text-center hover:bg-gray-50 hover:border-[#69AD49] hover:shadow-md transition-all focus:outline-none focus:ring-2 focus:ring-[#69AD49]"
                            >
                                {option.icon}
                                <h3 className="font-semibold text-lg text-gray-800">{option.title}</h3>
                                <p className="text-sm text-gray-600 mt-2">{option.description}</p>
                            </button>
                        ))}
                    </div>
                </main>
            </div>
        </div>
    );
};