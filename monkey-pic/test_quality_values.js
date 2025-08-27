// Test simple para verificar los valores de calidad
console.log('=== Test de valores de calidad ===');

function calculateTargetFaces(qualityLevel) {
    let sampleMax;
    switch (qualityLevel) {
        case 'normal': sampleMax = 300; break;  // 300 * 500 = 150K caras
        case 'alta': sampleMax = 700; break;    // 700 * 500 = 350K caras
        case 'maxima': sampleMax = 1000; break; // 1000 * 500 = 500K caras
        default: sampleMax = 700; break;
    }
    
    const targetFaces = Math.max(25000, sampleMax * 500);
    return targetFaces;
}

const qualities = ['normal', 'alta', 'maxima'];
qualities.forEach(quality => {
    const faces = calculateTargetFaces(quality);
    const facesK = Math.round(faces / 1000);
    let sampleMax;
    switch (quality) {
        case 'normal': sampleMax = 300; break;
        case 'alta': sampleMax = 700; break;
        case 'maxima': sampleMax = 1000; break;
        default: sampleMax = 700; break;
    }
    console.log(`${quality}: ${sampleMax} * 500 = ${faces} caras (${facesK}K)`);
});

// También verificar que el cálculo está correcto
const normal = calculateTargetFaces('normal');
const alta = calculateTargetFaces('alta');
const maxima = calculateTargetFaces('maxima');

console.log('\n=== Resultados esperados ===');
console.log(`Normal: ${normal} caras (${Math.round(normal/1000)}K)`);
console.log(`Alta: ${alta} caras (${Math.round(alta/1000)}K)`);
console.log(`Máxima: ${maxima} caras (${Math.round(maxima/1000)}K)`);
