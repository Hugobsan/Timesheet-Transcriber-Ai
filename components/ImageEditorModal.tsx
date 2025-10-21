import React, { useState, useRef, useEffect } from 'react';
import ReactCrop, { type Crop, centerCrop, makeAspectCrop } from 'react-image-crop';
import { XMarkIcon, RotateClockwiseIcon, RotateCounterClockwiseIcon, MagnifyingGlassPlusIcon, MagnifyingGlassMinusIcon } from './icons';

interface ImageEditorModalProps {
    isOpen: boolean;
    imageFile: File;
    onClose: () => void;
    onConfirm: (editedFile: File) => void;
}

// Function to get the cropped image data as a Blob
function getCroppedImg(
    image: HTMLImageElement,
    crop: Crop,
    rotation = 0
): Promise<Blob | null> {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    if (!ctx) {
        return Promise.reject(new Error('Failed to get canvas context'));
    }

    const scaleX = image.naturalWidth / image.width;
    const scaleY = image.naturalHeight / image.height;
    
    const cropX = crop.x * scaleX;
    const cropY = crop.y * scaleY;
    const cropWidth = crop.width * scaleX;
    const cropHeight = crop.height * scaleY;

    // Set canvas size to match the rotated crop size
    if (rotation === 90 || rotation === 270) {
        canvas.width = cropHeight;
        canvas.height = cropWidth;
    } else {
        canvas.width = cropWidth;
        canvas.height = cropHeight;
    }

    // Move the rotation point to the center of the canvas
    ctx.translate(canvas.width / 2, canvas.height / 2);
    
    // Rotate the canvas
    ctx.rotate((rotation * Math.PI) / 180);

    // Draw the cropped portion of the source image onto the rotated canvas.
    // The destination x, y coordinates are relative to the translated/rotated origin,
    // so we draw at (-cropWidth/2, -cropHeight/2) to center the crop in the canvas.
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

    return new Promise((resolve, reject) => {
        canvas.toBlob(blob => {
            if (!blob) {
                reject(new Error('Canvas is empty'));
                return;
            }
            resolve(blob);
        }, 'image/png', 1);
    });
}


export const ImageEditorModal: React.FC<ImageEditorModalProps> = ({
    isOpen,
    imageFile,
    onClose,
    onConfirm
}) => {
    const [imgSrc, setImgSrc] = useState('');
    const [crop, setCrop] = useState<Crop>();
    const [rotation, setRotation] = useState(0);
    const [scale, setScale] = useState(1);
    const [isProcessing, setIsProcessing] = useState(false);
    const imgRef = useRef<HTMLImageElement>(null);

    useEffect(() => {
        if (!imageFile) return;
        const objectUrl = URL.createObjectURL(imageFile);
        setImgSrc(objectUrl);
        setRotation(0);
        setScale(1);
        setCrop(undefined); // Reset crop on new image
        return () => URL.revokeObjectURL(objectUrl);
    }, [imageFile]);

    const onImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
        const { width, height } = e.currentTarget;
        const initialCrop = centerCrop(
            makeAspectCrop(
                {
                    unit: '%',
                    width: 90,
                },
                1, // No aspect ratio constraint
                width,
                height,
            ),
            width,
            height,
        );
        setCrop(initialCrop);
    };

    const handleRotate = (degrees: number) => {
        setRotation(prev => (prev + degrees + 360) % 360);
    };

    const handleConfirm = async () => {
        if (!imgRef.current || !crop || crop.width === 0 || crop.height === 0) {
            console.error('Cannot confirm: Invalid crop or image reference.');
            return;
        }
        setIsProcessing(true);
        try {
            // Note: The getCroppedImg function works on the original image dimensions,
            // so the visual scale doesn't need to be passed to it.
            const blob = await getCroppedImg(imgRef.current, crop, rotation);
            if (blob) {
                const newFileName = `${imageFile.name.split('.').slice(0, -1).join('.')}-edited.png`;
                const editedFile = new File([blob], newFileName, { type: 'image/png' });
                onConfirm(editedFile);
            }
        } catch (error) {
            console.error('Failed to process image:', error);
        } finally {
            setIsProcessing(false);
        }
    };
    
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-70 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-lg shadow-2xl w-full max-w-4xl h-[90vh] flex flex-col">
                <header className="flex items-center justify-between p-4 border-b border-gray-200">
                    <h2 className="text-xl font-semibold text-gray-800">Editar Imagem</h2>
                    <button onClick={onClose} className="p-1 text-gray-500 hover:text-gray-800">
                        <XMarkIcon className="w-6 h-6" />
                    </button>
                </header>

                <main className="flex-grow p-4 overflow-auto bg-gray-100 flex items-center justify-center">
                    {imgSrc && (
                        <ReactCrop
                            crop={crop}
                            onChange={c => setCrop(c)}
                            aspect={undefined} // Free crop
                        >
                            <img
                                ref={imgRef}
                                src={imgSrc}
                                alt="Crop preview"
                                style={{ transform: `scale(${scale}) rotate(${rotation}deg)`, maxHeight: '70vh' }}
                                onLoad={onImageLoad}
                            />
                        </ReactCrop>
                    )}
                </main>
                
                <footer className="flex items-center justify-between p-4 border-t border-gray-200 bg-gray-50">
                    <div className="flex items-center gap-2">
                         <button onClick={() => handleRotate(-90)} className="p-2 text-gray-600 font-semibold rounded-md hover:bg-gray-200 transition-colors" title="Girar Anti-horário">
                            <RotateCounterClockwiseIcon className="w-6 h-6" />
                        </button>
                         <button onClick={() => handleRotate(90)} className="p-2 text-gray-600 font-semibold rounded-md hover:bg-gray-200 transition-colors" title="Girar Horário">
                            <RotateClockwiseIcon className="w-6 h-6" />
                        </button>
                    </div>

                    <div className="flex items-center gap-2">
                        <button onClick={() => setScale(s => Math.max(0.5, s - 0.1))} className="p-1 text-gray-600 rounded-full hover:bg-gray-200 transition-colors">
                            <MagnifyingGlassMinusIcon className="w-5 h-5"/>
                        </button>
                        <input
                            type="range"
                            min="0.5"
                            max="3"
                            step="0.01"
                            value={scale}
                            onChange={(e) => setScale(parseFloat(e.target.value))}
                            className="w-32 md:w-40 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-[#69AD49]"
                            title={`Zoom: ${Math.round(scale * 100)}%`}
                        />
                         <button onClick={() => setScale(s => Math.min(3, s + 0.1))} className="p-1 text-gray-600 rounded-full hover:bg-gray-200 transition-colors">
                            <MagnifyingGlassPlusIcon className="w-5 h-5"/>
                        </button>
                    </div>

                    <div className="flex items-center">
                        <button onClick={onClose} className="px-4 py-2 text-gray-700 font-semibold rounded-md hover:bg-gray-200 transition-colors mr-3">
                            Cancelar
                        </button>
                        <button 
                            onClick={handleConfirm}
                            disabled={isProcessing}
                            className="px-5 py-2 bg-[#69AD49] text-white font-semibold rounded-md hover:bg-[#5a9a3f] disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                        >
                            {isProcessing ? 'Processando...' : 'Confirmar'}
                        </button>
                    </div>
                </footer>
            </div>
        </div>
    );
};