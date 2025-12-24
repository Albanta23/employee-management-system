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
     * Guarda/abre el PDF de forma compatible con WebViews (Capacitor / navegadores embebidos)
     * En WebView, los mecanismos de descarga suelen fallar; se abre el PDF para que el usuario lo guarde/comparta.
     */
    savePdf: async (doc, fileName) => {
        const safeFileName = (fileName || 'documento.pdf').toString().replace(/[^\w\-.]+/g, '_');

        const ua = (navigator && navigator.userAgent) ? navigator.userAgent : '';
        const isCapacitor = !!(window.Capacitor && typeof window.Capacitor.getPlatform === 'function' && window.Capacitor.getPlatform() !== 'web');
        const isAndroidWebView = /;\s*wv\)/i.test(ua) || /\bwv\b/i.test(ua);
        const isEmbeddedBrowser = isCapacitor || isAndroidWebView;

        // En navegador "normal" preferimos descarga directa.
        if (!isEmbeddedBrowser) {
            doc.save(safeFileName);
            return;
        }

        // 1) En Capacitor: guardamos a fichero y abrimos el diálogo de compartir.
        // Esto es mucho más fiable que blob URLs en WebView.
        if (isCapacitor) {
            try {
                const Plugins = (window.Capacitor && window.Capacitor.Plugins) ? window.Capacitor.Plugins : {};
                const Filesystem = Plugins.Filesystem;
                const Share = Plugins.Share;

                if (Filesystem && Share) {
                    const blob = doc.output('blob');
                    const base64Data = await new Promise((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onerror = () => reject(reader.error || new Error('No se pudo leer el PDF'));
                        reader.onload = () => {
                            const result = String(reader.result || '');
                            const commaIdx = result.indexOf(',');
                            resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
                        };
                        reader.readAsDataURL(blob);
                    });

                    const uniqueName = safeFileName.replace(/\.pdf$/i, '') + '_' + Date.now() + '.pdf';
                    const directory = (Filesystem.Directory && Filesystem.Directory.Cache) ? Filesystem.Directory.Cache : 'CACHE';

                    await Filesystem.writeFile({
                        path: uniqueName,
                        data: base64Data,
                        directory
                    });

                    const uriRes = await Filesystem.getUri({ path: uniqueName, directory });
                    const fileUri = uriRes && uriRes.uri ? uriRes.uri : '';
                    if (!fileUri) throw new Error('No se pudo obtener la URI del archivo');

                    await Share.share({
                        title: safeFileName,
                        url: fileUri
                    });
                    return;
                }
            } catch (e) {
                console.warn('Fallo guardando/compartiendo PDF en Capacitor, usando fallback WebView', e);
                // seguimos al fallback de WebView
            }
        }

        // 2) WebView (no-Capacitor): intentamos descarga con <a download> (evita popups).
        try {
            const blob = doc.output('blob');
            const blobUrl = URL.createObjectURL(blob);

            try {
                const a = document.createElement('a');
                a.href = blobUrl;
                a.download = safeFileName;
                a.target = '_self';
                a.rel = 'noopener';
                document.body.appendChild(a);
                a.click();
                a.remove();
            } catch (_) {
                // si falla el click programático, intentamos abrirlo
                const opened = window.open(blobUrl, '_blank');
                if (!opened) window.location.assign(blobUrl);
            }

            setTimeout(() => {
                try { URL.revokeObjectURL(blobUrl); } catch (_) { }
            }, 60 * 1000);
        } catch (e) {
            console.warn('Fallo al abrir/descargar PDF en WebView, usando doc.save como fallback', e);
            try {
                doc.save(safeFileName);
            } catch (e2) {
                alert('No se pudo generar/abrir el PDF en este navegador. Prueba desde Chrome/Safari o desde un PC.');
            }
        }
    },

    /**
     * Genera un justificante individual profesional
     */
    // Cargar configuración desde el servidor si es posible
    loadConfig: async () => {
        if (typeof settingsAPI !== 'undefined') {
            try {
                const settings = await settingsAPI.get();
                if (settings) {
                    if (settings.company_name) reportsUtil.config.companyName = settings.company_name;
                    if (settings.logo_base64) reportsUtil.config.logoBase64 = settings.logo_base64;
                    if (settings.company_address) reportsUtil.config.companyAddress = settings.company_address;
                    if (settings.company_cif) reportsUtil.config.companyCif = settings.company_cif;
                }
            } catch (e) {
                console.warn('No se pudo cargar la configuración personalizada', e);
            }
        }
    },

    /**
     * Genera un justificante individual profesional
     */
    generateJustification: async (data, typeTitle) => {
        if (!window.jspdf) return alert('Error: La librería PDF no está cargada.');

        await reportsUtil.loadConfig();

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        const config = reportsUtil.config;

        // Cabecera con estilo
        doc.setFillColor(...config.secondaryColor);
        doc.rect(0, 0, 210, 40, 'F');

        // Logo si existe
        if (config.logoBase64) {
            try {
                doc.addImage(config.logoBase64, 'PNG', 10, 5, 30, 30, undefined, 'FAST');
            } catch (e) { console.warn('Error añadiendo logo', e); }
        }

        doc.setTextColor(255, 255, 255);
        doc.setFontSize(22);
        doc.setFont('helvetica', 'bold');
        doc.text('JUSTIFICANTE DE ' + (typeTitle || 'SOLICITUD').toUpperCase(), 105, 20, { align: 'center' });

        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.text(config.companyName || 'SISTEMA DE GESTIÓN', 105, 30, { align: 'center' });

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

        // Pie de página mejorado
        const footerY = 280;
        doc.setFontSize(8);
        doc.setTextColor(150, 150, 150);

        let footerText = `Documento generado el ${new Date().toLocaleDateString('es-ES')}`;
        if (config.companyCif) footerText += ` | CIF: ${config.companyCif}`;
        if (config.companyAddress) footerText += ` | ${config.companyAddress}`;

        doc.text(footerText, 105, footerY, { align: 'center', maxWidth: 180 });

        reportsUtil.addWatermark(doc);

        await reportsUtil.savePdf(
            doc,
            `Justificante_${(data.full_name || 'Empleado').replace(/\s/g, '_')}.pdf`
        );
    },

    /**
     * Exporta una lista (tabla) a PDF
     */
    exportTable: async (title, columns, rows, fileName, orientationOrOptions = 'p') => {
        if (!window.jspdf) return alert('Error: La librería PDF no está cargada.');

        await reportsUtil.loadConfig();

        let orientation = 'p';
        let metaLines = [];
        let footerRows = [];

        if (typeof orientationOrOptions === 'string') {
            orientation = orientationOrOptions;
        } else if (orientationOrOptions && typeof orientationOrOptions === 'object') {
            orientation = orientationOrOptions.orientation || 'p';
            metaLines = Array.isArray(orientationOrOptions.metaLines) ? orientationOrOptions.metaLines : [];
            footerRows = Array.isArray(orientationOrOptions.footerRows) ? orientationOrOptions.footerRows : [];
        }

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ orientation: orientation });
        const config = reportsUtil.config;

        // Logo
        if (config.logoBase64) {
            try {
                doc.addImage(config.logoBase64, 'PNG', 14, 10, 15, 15, undefined, 'FAST');
            } catch (e) { }
        }

        const titleX = config.logoBase64 ? 35 : 14;

        doc.setFontSize(18);
        doc.setTextColor(...config.secondaryColor);
        doc.text(title, titleX, 20);

        doc.setFontSize(10);
        doc.setTextColor(100);
        doc.text(`${config.companyName} - Generado el ${new Date().toLocaleDateString('es-ES')}`, titleX, 28);

        if (config.companyCif) {
            doc.setFontSize(8);
            doc.text(`CIF: ${config.companyCif}`, titleX, 32);
        }

        let startY = 40;
        if (metaLines.length > 0) {
            doc.setFontSize(9);
            doc.setTextColor(80);
            let y = config.companyCif ? 36 : 34;
            metaLines
                .filter(l => l !== null && l !== undefined && String(l).trim() !== '')
                .slice(0, 6)
                .forEach(line => {
                    doc.text(String(line), titleX, y);
                    y += 5;
                });
            startY = Math.max(startY, y + 3);
        }

        const finalRows = Array.isArray(rows) ? rows.slice() : [];
        if (Array.isArray(footerRows) && footerRows.length > 0) {
            finalRows.push(...footerRows);
        }

        doc.autoTable({
            startY,
            head: [columns],
            body: finalRows,
            headStyles: { fillColor: config.primaryColor },
            alternateRowStyles: { fillColor: [245, 247, 250] },
            margin: { top: 40 },
            styles: { fontSize: 8, cellPadding: 2, overflow: 'linebreak' },
            columnStyles: {
                0: { cellWidth: 'auto' }
            }
        });

        reportsUtil.addWatermark(doc);

        await reportsUtil.savePdf(
            doc,
            `${fileName}_${new Date().toISOString().split('T')[0]}.pdf`
        );
    },

    /**
     * Exporta reporte agrupado por día con cálculo de horas trabajadas
     */
    exportGroupedAttendancePDF: async (title, groupedData, fileName) => {
        if (!window.jspdf) return alert('Error: La librería PDF no está cargada.');

        await reportsUtil.loadConfig();

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        const config = reportsUtil.config;

        // Cabecera Documento
        doc.setFillColor(...config.secondaryColor);
        doc.rect(0, 0, 210, 25, 'F');

        if (config.logoBase64) {
            try {
                doc.addImage(config.logoBase64, 'PNG', 6, 3, 19, 19, undefined, 'FAST');
            } catch (e) { console.warn(e) }
        }

        const textX = config.logoBase64 ? 30 : 14;

        doc.setFontSize(14);
        doc.setTextColor(255, 255, 255);
        doc.setFont('helvetica', 'bold');
        doc.text(title, textX, 12);

        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        doc.text(config.companyName, textX, 18);

        doc.text(`Generado el: ${new Date().toLocaleDateString('es-ES')}`, 200, 17, { align: 'right' });

        // Preparar filas para autoTable
        const rows = [];
        const labels = { in: 'ENTRADA', out: 'SALIDA', break_start: 'PAUSA (INI)', break_end: 'PAUSA (FIN)' };

        Object.keys(groupedData).forEach(key => {
            const group = groupedData[key];
            const workTimeMs = reportsUtil.calculateWorkTime(group.logs);
            const workHours = Math.floor(workTimeMs / (1000 * 60 * 60));
            const workMinutes = Math.floor((workTimeMs % (1000 * 60 * 60)) / (1000 * 60));
            const timeString = `${workHours}h ${workMinutes}m`;
            rows.push([
                {
                    content: `${group.date} - ${group.employee} (DNI: ${group.dni || 'N/A'}) - Total: ${timeString}`,
                    colSpan: 4,
                    styles: { fillColor: [226, 232, 240], fontStyle: 'bold', textColor: [30, 41, 59] }
                }
            ]);

            group.logs.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
            group.logs.forEach(l => {
                rows.push([
                    new Date(l.timestamp).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }),
                    labels[l.type] || l.type,
                    l.location || '-',
                    l.device_info || '-'
                ]);
            });
        });

        doc.autoTable({
            startY: 35,
            head: [['Hora', 'Evento', 'Ubicación', 'Dispositivo']],
            body: rows,
            headStyles: { fillColor: config.primaryColor, fontSize: 10 },
            bodyStyles: { fontSize: 9, cellPadding: 2 },
            theme: 'grid',
            columnStyles: {
                0: { cellWidth: 20 },
                1: { cellWidth: 40 },
                2: { cellWidth: 60 },
                3: { cellWidth: 'auto' }
            }
        });

        // Añadir marca de agua
        reportsUtil.addWatermark(doc);

        // Pie que incluye datos empresa
        const pageCount = doc.internal.getNumberOfPages();
        for (let i = 1; i <= pageCount; i++) {
            doc.setPage(i);
            doc.setFontSize(8);
            doc.setTextColor(150);
            let footer = `Página ${i} de ${pageCount}`;
            if (config.companyName) footer += ` - ${config.companyName}`;
            if (config.companyCif) footer += ` - CIF: ${config.companyCif}`;
            doc.text(footer, 105, 290, { align: 'center' });
        }

        await reportsUtil.savePdf(doc, `${fileName}.pdf`);
    },

    /**
     * Añade marca de agua a todas las páginas
     */
    addWatermark: (doc) => {
        const config = reportsUtil.config;
        const totalPages = doc.internal.getNumberOfPages();

        for (let i = 1; i <= totalPages; i++) {
            doc.setPage(i);
            try {
                if (doc.saveGraphicsState) doc.saveGraphicsState();

                if (window.jspdf.GState) {
                    doc.setGState(new window.jspdf.GState({ opacity: 0.05 }));
                } else {
                    doc.setTextColor(230, 230, 230);
                }

                const width = doc.internal.pageSize.getWidth();
                const height = doc.internal.pageSize.getHeight();

                if (config.logoBase64) {
                    const imgDim = 100;
                    const x = (width - imgDim) / 2;
                    const y = (height - imgDim) / 2;
                    doc.addImage(config.logoBase64, 'PNG', x, y, imgDim, imgDim, undefined, 'FAST');
                } else {
                    doc.setFontSize(60);
                    if (!window.jspdf.GState) doc.setTextColor(240, 240, 240);
                    else doc.setTextColor(0, 0, 0);

                    doc.text((config.companyName || 'CONFIDENCIAL').toUpperCase(), width / 2, height / 2, {
                        align: 'center',
                        angle: 45
                    });
                }

                if (doc.restoreGraphicsState) doc.restoreGraphicsState();
            } catch (e) { console.warn('Watermark error', e); }
        }
    },

    /**
     * Calcula tiempo de trabajo en milisegundos
     */
    calculateWorkTime: (logs) => {
        let totalMs = 0;
        let lastTime = null;
        const sorted = [...logs].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

        sorted.forEach(log => {
            const time = new Date(log.timestamp).getTime();
            if (log.type === 'in' || log.type === 'break_end') {
                lastTime = time;
            } else if ((log.type === 'out' || log.type === 'break_start') && lastTime !== null) {
                totalMs += (time - lastTime);
                lastTime = null;
            }
        });
        return totalMs;
    }
};
