/**
 * Utilidades para exportación de documentos PDF
 * Utiliza jsPDF y jsPDF-AutoTable via CDN
 */

const reportsUtil = {
    // Configuración básica
    config: {
        companyName: 'SISTEMA DE GESTIÓN DE RECURSOS HUMANOS',
        primaryColor: [99, 102, 241], // var(--primary) en RGB
        secondaryColor: [30, 41, 59]  // var(--bg-sidebar) en RGB
    },

    /**
     * Genera un justificante individual profesional
     */
    generateJustification: async (data, typeTitle) => {
        if (!window.jspdf) {
            console.error('jsPDF no cargado');
            return alert('Error: La librería PDF no está cargada.');
        }

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        const config = reportsUtil.config;

        // Cabecera con estilo
        doc.setFillColor(...config.secondaryColor);
        doc.rect(0, 0, 210, 40, 'F');

        doc.setTextColor(255, 255, 255);
        doc.setFontSize(22);
        doc.setFont('helvetica', 'bold');
        doc.text('JUSTIFICANTE DE ' + (typeTitle || 'SOLICITUD').toUpperCase(), 105, 20, { align: 'center' });

        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.text(config.companyName, 105, 30, { align: 'center' });

        // Cuerpo del documento
        doc.setTextColor(0, 0, 0);
        let y = 60;

        // Sección: Datos del Trabajador
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.text('DATOS DEL TRABAJADOR', 20, y);
        doc.setLineWidth(0.5);
        doc.line(20, y + 2, 190, y + 2);

        y += 15;
        doc.setFontSize(11);
        doc.setFont('helvetica', 'normal');
        doc.text(`Nombre Completo: ${data.full_name || 'N/A'}`, 25, y);
        y += 8;
        doc.text(`DNI / Identificación: ${data.dni || '-'}`, 25, y);
        y += 8;
        doc.text(`Puesto: ${data.position || '-'}`, 25, y);
        y += 8;
        doc.text(`Tienda / Ubicación: ${data.location || '-'}`, 25, y);

        y += 20;

        // Sección: Detalles de la Solicitud
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.text('DETALLES DE LA SOLICITUD', 20, y);
        doc.line(20, y + 2, 190, y + 2);

        y += 15;
        doc.setFontSize(11);
        doc.setFont('helvetica', 'normal');

        if (data.start_date) {
            const dateStr = data.end_date ? `${formatDate(data.start_date)} hasta ${formatDate(data.end_date)}` : formatDate(data.start_date);
            doc.text(`Periodo: ${dateStr}`, 25, y);
            y += 8;
        }

        if (data.days) {
            doc.text(`Total días: ${data.days}`, 25, y);
            y += 8;
        }

        doc.text(`Tipo: ${typeTitle || '-'}`, 25, y);
        y += 8;

        if (data.reason || data.notes) {
            doc.text(`Motivo/Notas:`, 25, y);
            y += 6;
            const splitReason = doc.splitTextToSize(data.reason || data.notes || '-', 160);
            doc.text(splitReason, 30, y);
            y += (splitReason.length * 6);
        }

        y += 10;
        doc.text(`Estado: ${(data.status || 'pendiente').toUpperCase()}`, 25, y);

        // Sección: Firmas
        y = 230;
        doc.setLineWidth(0.2);
        doc.line(30, y, 90, y);
        doc.line(120, y, 180, y);

        y += 5;
        doc.setFontSize(10);
        doc.text('Firma del Trabajador', 60, y, { align: 'center' });
        doc.text('Sello y Firma Gerencia', 150, y, { align: 'center' });

        // Pie de página
        doc.setFontSize(8);
        doc.setTextColor(150, 150, 150);
        const today = new Date().toLocaleDateString('es-ES');
        doc.text(`Documento generado el ${today} - Copia para el empleado y la empresa`, 105, 285, { align: 'center' });

        doc.save(`Justificante_${(data.full_name || 'Empleado').replace(/\s/g, '_')}.pdf`);
    },

    /**
     * Exporta una lista (tabla) a PDF
     */
    exportTable: (title, columns, rows, fileName, orientation = 'p') => {
        if (!window.jspdf) {
            console.error('jsPDF no cargado');
            return alert('Error: La librería PDF no está cargada.');
        }

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ orientation: orientation });
        const config = reportsUtil.config;

        doc.setFontSize(18);
        doc.setTextColor(...config.secondaryColor);
        doc.text(title, 14, 22);

        doc.setFontSize(10);
        doc.setTextColor(100);
        doc.text(`${config.companyName} - Generado el ${new Date().toLocaleDateString('es-ES')}`, 14, 30);

        doc.autoTable({
            startY: 40,
            head: [columns],
            body: rows,
            headStyles: { fillColor: config.primaryColor },
            alternateRowStyles: { fillColor: [245, 247, 250] },
            margin: { top: 40 },
            styles: { fontSize: 8, cellPadding: 2, overflow: 'linebreak' },
            columnStyles: {
                0: { cellWidth: 'auto' }
            }
        });

        doc.save(`${fileName}_${new Date().toISOString().split('T')[0]}.pdf`);
    }
};
