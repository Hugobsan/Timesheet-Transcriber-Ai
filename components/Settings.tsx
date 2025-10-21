

import React from 'react';
import { SettingsIcon, ChevronDownIcon } from './icons';

interface SettingsProps {
    isOpen: boolean;
    toggle: () => void;
    apiKey: string;
    setApiKey: (key: string) => void;
    systemPrompt: string;
    setSystemPrompt: (prompt: string) => void;
    temperature: number;
    setTemperature: (temp: number) => void;
    model: string;
    setModel: (model: string) => void;
    availableModels: string[];
    onSave: () => void;
}

export const Settings: React.FC<SettingsProps> = ({
    isOpen,
    toggle,
    apiKey,
    setApiKey,
    systemPrompt,
    setSystemPrompt,
    temperature,
    setTemperature,
    model,
    setModel,
    availableModels,
    onSave,
}) => {
    return (
        <div className="bg-white border border-gray-200 rounded-lg mb-6 shadow-sm">
            <button
                onClick={toggle}
                className="w-full flex justify-between items-center p-4 text-left text-lg font-semibold text-gray-700"
            >
                <div className="flex items-center gap-3">
                    <SettingsIcon className="w-6 h-6 text-gray-500" />
                    Configuração
                </div>
                <ChevronDownIcon className={`w-5 h-5 transition-transform text-gray-500 ${isOpen ? 'rotate-180' : ''}`} />
            </button>
            {isOpen && (
                <div className="p-4 border-t border-gray-200">
                    <div className="space-y-6">
                        <div>
                            <label htmlFor="apiKey" className="block text-sm font-medium text-gray-700 mb-1">
                                Chave de API Gemini
                            </label>
                            <input
                                type="password"
                                id="apiKey"
                                value={apiKey}
                                onChange={(e) => setApiKey(e.target.value)}
                                placeholder="Cole sua chave de API aqui"
                                className="w-full bg-gray-50 border border-gray-300 rounded-md px-3 py-2 text-gray-900 focus:ring-2 focus:ring-[#69AD49] focus:border-[#69AD49] transition"
                            />
                        </div>
                        <div>
                            <label htmlFor="model" className="block text-sm font-medium text-gray-700 mb-1">
                                Modelo Gemini
                            </label>
                            <input
                                list="models-list"
                                id="model"
                                value={model}
                                onChange={(e) => setModel(e.target.value)}
                                placeholder="ex: gemini-flash-latest"
                                className="w-full bg-gray-50 border border-gray-300 rounded-md px-3 py-2 text-gray-900 focus:ring-2 focus:ring-[#69AD49] focus:border-[#69AD49] transition"
                            />
                            <datalist id="models-list">
                                {availableModels.map((m) => <option key={m} value={m} />)}
                            </datalist>
                        </div>
                        <div>
                            <label htmlFor="systemPrompt" className="block text-sm font-medium text-gray-700 mb-1">
                                Prompt do Sistema
                            </label>
                            <textarea
                                id="systemPrompt"
                                rows={10}
                                value={systemPrompt}
                                onChange={(e) => setSystemPrompt(e.target.value)}
                                className="w-full bg-gray-50 border border-gray-300 rounded-md px-3 py-2 text-gray-900 focus:ring-2 focus:ring-[#69AD49] focus:border-[#69AD49] font-mono text-sm transition"
                            />
                        </div>
                        <div>
                            <label htmlFor="temperature" className="block text-sm font-medium text-gray-700 mb-2">
                                Temperatura: <span className="font-bold text-[#1B5E20]">{temperature.toFixed(2)}</span>
                            </label>
                             <input
                                type="range"
                                id="temperature"
                                min="0"
                                max="1"
                                step="0.01"
                                value={temperature}
                                onChange={(e) => setTemperature(parseFloat(e.target.value))}
                                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-[#69AD49]"
                            />
                        </div>
                        <div className="flex justify-end">
                            <button
                                onClick={onSave}
                                className="px-5 py-2 bg-[#69AD49] text-white font-semibold rounded-md hover:bg-[#5a9a3f] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#69AD49] focus:ring-offset-white transition-colors"
                            >
                                Salvar Configurações
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
