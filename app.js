// Credenciales Supabase
const SUPABASE_URL = "https://qaxxggokkclsfsjfmtbs.supabase.co";
const SUPABASE_KEY = "sb_publishable_xbiL5biH5Y9jUf9wfM-7Fg_C2TqshKs";
const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Memorias locales
let mapMaestroSKU = new Map();
let mapMaestroUbicacion = new Map();

let listEvaluaciones = []; // Contiene TODAS las líneas (cumplidas y desviadas)
let listDesviados = [];    // Solo desviadas (cumplimiento === 0)
let listResumenPasillos = [];
let isMastersLoaded = false;

let currentSortColumn = 'pasillo';
let currentSortDirection = 'asc';

function parseNum(val) {
    if (val === null || val === undefined) return 0;
    if (typeof val === 'number') return val;
    const cleaned = String(val).replace(/,/g, '').trim();
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
}

function cleanSKU(val) {
    if (!val) return '';
    let cleaned = String(val).replace(/=/g, '').replace(/"/g, '').trim();
    return cleaned.replace(/^0+/, '');
}

function cleanString(val) {
    if (!val) return '';
    return String(val).replace(/=/g, '').replace(/"/g, '').trim();
}

function cleanUbicacion(val) {
    if (!val) return '';
    return String(val).replace(/=/g, '').replace(/"/g, '').trim().replace(/-$/, '');
}

document.addEventListener('DOMContentLoaded', async () => {
    setupEventListeners();
    await cargarMaestrosSupabasePaginado();
    await cargarSnapshotDesdeSupabasePaginado();
});

// 1. CARGA COMPLETA DE MAESTROS DESDE SUPABASE (PAGINADO SIN LÍMITE DE 1000)
async function cargarMaestrosSupabasePaginado() {
    try {
        console.log("Cargando maestro_sku desde Supabase...");

        let allSkus = [];
        let fromSku = 0;
        let stepSku = 1000;
        let hasMoreSku = true;

        while (hasMoreSku) {
            const { data, error } = await _supabase
                .from('maestro_sku')
                .select('sku, curva_oficial, curva, curva_rep')
                .range(fromSku, fromSku + stepSku - 1);

            if (error) throw error;
            if (data && data.length > 0) {
                allSkus.push(...data);
                fromSku += stepSku;
                if (data.length < stepSku) hasMoreSku = false;
            } else {
                hasMoreSku = false;
            }
        }

        mapMaestroSKU.clear();
        allSkus.forEach(item => {
            const rawSku = cleanString(item.sku);
            const skuClean = cleanSKU(item.sku);

            let valOficial = item.curva_oficial ? cleanString(item.curva_oficial).toUpperCase() : '';
            let valCurva = item.curva ? cleanString(item.curva).toUpperCase() : '';
            let valRep = item.curva_rep ? cleanString(item.curva_rep).toUpperCase() : '';

            let curvaFinal = '';
            if (valOficial) {
                curvaFinal = valOficial;
            } else if (valCurva && valRep) {
                curvaFinal = valCurva + valRep;
            } else if (valCurva) {
                curvaFinal = valCurva;
            } else {
                curvaFinal = 'C';
            }

            if (rawSku) mapMaestroSKU.set(rawSku, curvaFinal);
            if (skuClean) mapMaestroSKU.set(skuClean, curvaFinal);
        });

        // Cargar maestro_ubicacion completo
        let allUbicaciones = [];
        let fromUbi = 0;
        let stepUbi = 1000;
        let hasMoreUbi = true;

        while (hasMoreUbi) {
            const { data, error } = await _supabase
                .from('maestro_ubicacion')
                .select('ubicacion, curva_actual, pasillo')
                .range(fromUbi, fromUbi + stepUbi - 1);

            if (error) throw error;
            if (data && data.length > 0) {
                allUbicaciones.push(...data);
                fromUbi += stepUbi;
                if (data.length < stepUbi) hasMoreUbi = false;
            } else {
                hasMoreUbi = false;
            }
        }

        mapMaestroUbicacion.clear();
        allUbicaciones.forEach(item => {
            const ubiClean = cleanUbicacion(item.ubicacion);
            const curva = item.curva_actual ? cleanString(item.curva_actual).toUpperCase() : '';
            const pasillo = item.pasillo ? String(item.pasillo).replace('.0', '').trim() : null;

            if (ubiClean) {
                mapMaestroUbicacion.set(ubiClean, { curva, pasillo });
            }
        });

        isMastersLoaded = true;

    } catch (err) {
        console.error("Error al cargar maestros:", err);
    }
}

// 2. RECUPERA TODO EL SNAPSHOT DE SUPABASE (TODAS LAS LÍNEAS, BUENAS Y MALAS)
async function cargarSnapshotDesdeSupabasePaginado() {
    try {
        let allRows = [];
        let fromRow = 0;
        let stepRow = 1000;
        let hasMore = true;

        while (hasMore) {
            const { data, error } = await _supabase
                .from('detalle_inventreserva')
                .select('*')
                .range(fromRow, fromRow + stepRow - 1);

            if (error) throw error;

            if (data && data.length > 0) {
                allRows.push(...data);
                fromRow += stepRow;
                if (data.length < stepRow) hasMore = false;
            } else {
                hasMore = false;
            }
        }

        if (allRows.length > 0) {
            listEvaluaciones = allRows;
            listDesviados = allRows.filter(r => r.cumplimiento === 0 || r.cumplimiento === '0');
            reconstruirResumenYRenderizar();
        } else {
            document.getElementById('tableBody').innerHTML = `
                <tr>
                    <td colspan="11" class="p-8 text-center text-slate-500 font-medium">
                        No hay datos guardados. Carga un archivo CSV WMS.
                    </td>
                </tr>`;
            document.getElementById('pasillosCount').textContent = 'Sin datos';
        }
    } catch (err) {
        console.error("Error al recuperar snapshot paginado:", err);
    }
}

// 3. PROCESAMIENTO CSV WMS
function procesarArchivoWMS(file) {
    if (!isMastersLoaded) {
        alert("Aún se están descargando las tablas maestras. Aguarda unos segundos.");
        return;
    }

    document.getElementById('uploadStatus').classList.remove('hidden');

    Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        encoding: "latin1",
        complete: async function (results) {
            await evaluarReservaYGuardar(results.data);
            document.getElementById('uploadStatus').classList.add('hidden');
            document.getElementById('uploadModal').classList.add('hidden');
        },
        error: function (err) {
            alert("Error al leer CSV: " + err);
            document.getElementById('uploadStatus').classList.add('hidden');
        }
    });
}

// 4. EVALUACIÓN Y GUARDADO COMPLETO (100% DE LÍNEAS) EN SUPABASE
async function evaluarReservaYGuardar(rows) {
    if (!rows || rows.length === 0) return;

    if (mapMaestroSKU.size === 0) {
        await cargarMaestrosSupabasePaginado();
    }

    const keys = Object.keys(rows[0]);

    const colSkuKey = keys.find(k => k.toLowerCase().includes('cod alternat')) || keys[16] || keys.find(k => k.toLowerCase().includes('producto')) || keys[1];
    const colAreaKey = keys.find(k => k.toLowerCase().includes('área') || k.toLowerCase().includes('area')) || keys[14];
    const colUbiKey = keys.find(k => k.toLowerCase().includes('texto mostrado') || k.toLowerCase().includes('ubicacion')) || keys[0];
    const colDescKey = keys.find(k => k.toLowerCase().includes('descripcion') || k.toLowerCase().includes('descripción')) || keys[2];
    const colLpnKey = keys.find(k => k.toLowerCase().includes('lpn actuales') || k.toLowerCase().includes('lpn actual')) || keys[5];
    const colCantKey = keys.find(k => k.toLowerCase().includes('cantidad actual')) || keys[3];
    const colAsigKey = keys.find(k => k.toLowerCase().includes('cant asig')) || keys[4];

    listEvaluaciones = [];
    listDesviados = [];

    rows.forEach(row => {
        const area = cleanString(row[colAreaKey]);
        if (area !== 'AIP01' && area !== 'AIP02') return;

        const skuRaw = cleanString(row[colSkuKey]);
        const skuLookup = cleanSKU(skuRaw);
        const ubicacion = cleanUbicacion(row[colUbiKey]);
        const descripcion = row[colDescKey] ? String(row[colDescKey]).trim() : '';
        const cantActual = parseNum(row[colCantKey]);
        const cantAsig = parseNum(row[colAsigKey]);
        const stockDisponible = cantActual - cantAsig;

        const ubiInfo = mapMaestroUbicacion.get(ubicacion);

        let pasillo = ubiInfo ? ubiInfo.pasillo : null;
        if (!pasillo) {
            const match = ubicacion.match(/(?:PAS|P|-)?(\d{3})(?:-|\b)/);
            pasillo = match ? match[1] : 'SIN PASILLO';
        }

        const curvaUbi = ubiInfo ? ubiInfo.curva : '';
        let curvaOficialSKU = mapMaestroSKU.get(skuRaw) || mapMaestroSKU.get(skuLookup) || 'C';

        let cumplimiento = 0;

        if (curvaUbi && curvaUbi !== 'NAN') {
            if (curvaOficialSKU === 'C') {
                if (curvaUbi === 'C' || curvaUbi === 'C1S' || curvaUbi === 'C2S' || curvaUbi.startsWith('C')) {
                    cumplimiento = 1;
                } else {
                    cumplimiento = 0;
                }
            } else if (curvaUbi.length === 1) {
                cumplimiento = curvaOficialSKU.startsWith(curvaUbi) ? 1 : 0;
            } else {
                cumplimiento = (curvaUbi === curvaOficialSKU) ? 1 : 0;
            }
        }

        const registro = {
            area: area,
            pasillo: pasillo,
            ubicacion: ubicacion,
            sku: skuRaw,
            descripcion_producto: descripcion,
            curva_sku: curvaOficialSKU,
            curva_ubicacion: curvaUbi || 'SIN CURVA',
            lpn_actual: row[colLpnKey] ? String(row[colLpnKey]) : '',
            cantidad_actual: cantActual,
            stock_asignado: cantAsig,
            stock_disponible_reubicar: stockDisponible,
            cumplimiento: cumplimiento
        };

        listEvaluaciones.push(registro);
        if (cumplimiento === 0) {
            listDesviados.push(registro);
        }
    });

    try {
        // Limpiamos la tabla en Supabase e insertamos en lotes de 1000 para evitar bloqueos
        await _supabase.from('detalle_inventreserva').delete().neq('id', 0);

        if (listEvaluaciones.length > 0) {
            const batchSize = 1000;
            for (let i = 0; i < listEvaluaciones.length; i += batchSize) {
                const batch = listEvaluaciones.slice(i, i + batchSize);
                await _supabase.from('detalle_inventreserva').insert(batch);
            }
        }
    } catch (err) {
        console.error("Error al actualizar Supabase:", err);
    }

    reconstruirResumenYRenderizar();
}

// 5. CONSTRUCCIÓN DE KPIS GLOBALES Y TABLA RESUMEN POR PASILLO
// 5. CONSTRUCCIÓN DE KPIS GLOBALES Y TABLA RESUMEN POR PASILLO (CORREGIDO LPNs)
function reconstruirResumenYRenderizar() {
    const agrupadoPasillo = new Map();
    let totalSKUsSet = new Set();
    let totalLPNsSum = 0;
    let totalUnidadesSum = 0;

    let lineasTotalesEvaluadas = listEvaluaciones.length;
    let lineasCumplidas = 0;
    let lineasDesviadas = 0;

    listEvaluaciones.forEach(item => {
        if (item.sku) totalSKUsSet.add(item.sku);
        totalLPNsSum += parseNum(item.lpn_actual); // Sumatoria directa de la columna LPN
        totalUnidadesSum += parseNum(item.cantidad_actual);

        const esConforme = item.cumplimiento === 1 || item.cumplimiento === '1';
        if (esConforme) lineasCumplidas++;
        else lineasDesviadas++;

        const keyPasillo = `${item.area}|${item.pasillo}`;
        if (!agrupadoPasillo.has(keyPasillo)) {
            agrupadoPasillo.set(keyPasillo, {
                area: item.area,
                pasillo: item.pasillo,
                posicionesSet: new Set(),
                skusSet: new Set(),
                totalLPNs: 0,
                stockActual: 0,
                lineasTotales: 0,
                lineasConformes: 0,
                lineasDesviadas: 0
            });
        }

        const pasData = agrupadoPasillo.get(keyPasillo);
        if (item.ubicacion) pasData.posicionesSet.add(item.ubicacion);
        if (item.sku) pasData.skusSet.add(item.sku);
        pasData.totalLPNs += parseNum(item.lpn_actual); // Sumatoria por pasillo
        pasData.stockActual += parseNum(item.cantidad_actual);
        pasData.lineasTotales++;

        if (esConforme) {
            pasData.lineasConformes++;
        } else {
            pasData.lineasDesviadas++;
        }
    });

    listResumenPasillos = [];
    agrupadoPasillo.forEach(val => {
        const pasilloNum = parseNum(val.pasillo);
        let piso = 'Sin Asignar';

        if (val.area === 'AIP01') {
            if (pasilloNum === 101 || pasilloNum === 102) piso = 'Planta Baja';
            else if (pasilloNum >= 201 && pasilloNum <= 228) piso = 'Planta Alta';
        } else if (val.area === 'AIP02') {
            if ((pasilloNum >= 101 && pasilloNum <= 108) || (pasilloNum >= 201 && pasilloNum <= 208)) piso = 'Planta Baja';
            else if ((pasilloNum >= 301 && pasilloNum <= 308) || (pasilloNum >= 401 && pasilloNum <= 408)) piso = 'Piso 1';
            else if ((pasilloNum >= 501 && pasilloNum <= 508) || (pasilloNum >= 601 && pasilloNum <= 608)) piso = 'Piso 2';
        }

        const pctCumplimientoPasillo = val.lineasTotales > 0 ? (val.lineasConformes / val.lineasTotales) * 100 : 0;

        listResumenPasillos.push({
            area: val.area,
            pasillo: val.pasillo,
            piso_calculado: piso,
            total_posiciones: val.posicionesSet.size,
            total_skus_unicos: val.skusSet.size,
            total_lpns: val.totalLPNs,
            stock_actual: val.stockActual,
            lineas_totales: val.lineasTotales,
            lineas_conformes: val.lineasConformes,
            lineas_desviadas: val.lineasDesviadas,
            pct_cumplimiento: pctCumplimientoPasillo
        });
    });

    document.getElementById('exportExcelBtn').disabled = listDesviados.length === 0;

    const pctGlobal = lineasTotalesEvaluadas > 0 ? ((lineasCumplidas / lineasTotalesEvaluadas) * 100).toFixed(1) : '0.0';

    document.getElementById('kpi-cumplimiento').textContent = `${pctGlobal}%`;
    document.getElementById('kpi-skus-unicos').textContent = totalSKUsSet.size.toLocaleString('es-ES');
    document.getElementById('kpi-lpns').textContent = totalLPNsSum.toLocaleString('es-ES');
    document.getElementById('kpi-lineas-totales').textContent = lineasTotalesEvaluadas.toLocaleString('es-ES');
    document.getElementById('kpi-lineas-cumplidas').textContent = lineasCumplidas.toLocaleString('es-ES');
    document.getElementById('kpi-lineas-desviadas').textContent = lineasDesviadas.toLocaleString('es-ES');
    document.getElementById('kpi-unidades').textContent = Math.round(totalUnidadesSum).toLocaleString('es-ES');

    processAndRenderTable();
}

function processAndRenderTable() {
    const areaVal = document.getElementById('areaFilter').value;
    const pisoVal = document.getElementById('pisoFilter').value;
    const searchVal = document.getElementById('searchInput').value.toLowerCase();

    let filtered = listResumenPasillos.filter(item => {
        const matchArea = areaVal === 'TODAS' || item.area === areaVal;
        let matchPiso = true;
        if (pisoVal !== 'TODOS') {
            if (pisoVal === 'PB') matchPiso = item.piso_calculado === 'Planta Baja';
            else if (pisoVal === 'PA') matchPiso = item.piso_calculado === 'Planta Alta';
            else if (pisoVal === 'P1') matchPiso = item.piso_calculado === 'Piso 1';
            else if (pisoVal === 'P2') matchPiso = item.piso_calculado === 'Piso 2';
        }
        const matchSearch = !searchVal || (item.pasillo && item.pasillo.toString().toLowerCase().includes(searchVal));
        return matchArea && matchPiso && matchSearch;
    });

    renderTable(filtered);
}

function renderTable(data) {
    const tableBody = document.getElementById('tableBody');
    const pasillosCount = document.getElementById('pasillosCount');

    let sortedList = [...data].sort((a, b) => {
        let valA = a[currentSortColumn];
        let valB = b[currentSortColumn];
        const isNumeric = typeof valA === 'number';

        if (isNumeric) {
            valA = parseNum(valA);
            valB = parseNum(valB);
        } else {
            valA = String(valA).toLowerCase();
            valB = String(valB).toLowerCase();
        }

        return currentSortDirection === 'asc' ? (valA > valB ? 1 : -1) : (valA < valB ? 1 : -1);
    });

    renderTableHeaders();

    pasillosCount.textContent = `${sortedList.length} Pasillos procesados`;

    if (sortedList.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="11" class="p-8 text-center text-slate-500">No se encontraron registros.</td></tr>`;
        return;
    }

    tableBody.innerHTML = sortedList.map(g => {
        const pct = g.pct_cumplimiento;
        let badgeColor = 'bg-rose-100 text-rose-800 border-rose-300';
        if (pct >= 80) badgeColor = 'bg-emerald-100 text-emerald-800 border-emerald-300';
        else if (pct >= 50) badgeColor = 'bg-amber-100 text-amber-800 border-amber-300';

        return `
        <tr class="hover:bg-blue-50/50 transition-colors border-b border-slate-200">
            <td class="p-3 font-bold text-blue-900">${g.area}</td>
            <td class="p-3 font-medium text-slate-600">${g.piso_calculado}</td>
            <td class="p-3 font-semibold text-slate-800">Pasillo ${g.pasillo}</td>
            <td class="p-3 text-right font-medium text-slate-700">${parseNum(g.total_posiciones).toLocaleString('es-ES')}</td>
            <td class="p-3 text-right font-medium text-slate-700">${parseNum(g.total_skus_unicos).toLocaleString('es-ES')}</td>
            <td class="p-3 text-right font-bold text-indigo-700">${parseNum(g.total_lpns).toLocaleString('es-ES')}</td>
            <td class="p-3 text-right font-medium text-slate-700">${Math.round(parseNum(g.stock_actual)).toLocaleString('es-ES')}</td>
            <td class="p-3 text-right font-bold text-blue-900">${parseNum(g.lineas_totales).toLocaleString('es-ES')}</td>
            <td class="p-3 text-right font-bold text-emerald-600">${parseNum(g.lineas_conformes).toLocaleString('es-ES')}</td>
            <td class="p-3 text-right font-bold text-rose-600">${parseNum(g.lineas_desviadas).toLocaleString('es-ES')}</td>
            <td class="p-3 text-center font-bold">
                <span class="inline-block px-2.5 py-0.5 rounded-full text-[11px] border ${badgeColor}">
                    ${pct.toFixed(1)}%
                </span>
            </td>
        </tr>
    `}).join('');
}

function renderTableHeaders() {
    const thead = document.querySelector('table thead');
    const getArrow = (col) => (currentSortColumn === col ? (currentSortDirection === 'asc' ? ' ▲' : ' ▼') : ' ⇅');

    thead.innerHTML = `
        <tr>
            <th class="p-3 cursor-pointer" onclick="changeSort('area')">Área${getArrow('area')}</th>
            <th class="p-3">Nivel / Piso</th>
            <th class="p-3 cursor-pointer" onclick="changeSort('pasillo')">Pasillo${getArrow('pasillo')}</th>
            <th class="p-3 text-right cursor-pointer" onclick="changeSort('total_posiciones')">Posiciones${getArrow('total_posiciones')}</th>
            <th class="p-3 text-right cursor-pointer" onclick="changeSort('total_skus_unicos')">SKUs Únicos${getArrow('total_skus_unicos')}</th>
            <th class="p-3 text-right cursor-pointer text-indigo-900" onclick="changeSort('total_lpns')">Total LPNs${getArrow('total_lpns')}</th>
            <th class="p-3 text-right cursor-pointer" onclick="changeSort('stock_actual')">Unidades Totales${getArrow('stock_actual')}</th>
            <th class="p-3 text-right cursor-pointer text-blue-900" onclick="changeSort('lineas_totales')">Líneas Totales${getArrow('lineas_totales')}</th>
            <th class="p-3 text-right cursor-pointer text-emerald-700" onclick="changeSort('lineas_conformes')">Conformes${getArrow('lineas_conformes')}</th>
            <th class="p-3 text-right cursor-pointer text-rose-700" onclick="changeSort('lineas_desviadas')">Desviadas${getArrow('lineas_desviadas')}</th>
            <th class="p-3 text-center cursor-pointer" onclick="changeSort('pct_cumplimiento')">% Cumplimiento${getArrow('pct_cumplimiento')}</th>
        </tr>
    `;
}

window.changeSort = function (column) {
    if (currentSortColumn === column) {
        currentSortDirection = currentSortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        currentSortColumn = column;
        currentSortDirection = 'desc';
    }
    processAndRenderTable();
};

// EXPORTA ÚNICAMENTE LOS PRODUCTOS DESVIADOS (CUMPLIMIENTO === 0)
function exportarProductosMalUbicados() {
    if (!listDesviados || listDesviados.length === 0) {
        alert("No hay productos mal ubicados para exportar.");
        return;
    }

    const sortedDesviados = [...listDesviados].sort((a, b) => {
        if (a.area !== b.area) return a.area.localeCompare(b.area);
        if (a.pasillo !== b.pasillo) return parseNum(a.pasillo) - parseNum(b.pasillo);
        return a.ubicacion.localeCompare(b.ubicacion);
    });

    const worksheet = XLSX.utils.json_to_sheet(sortedDesviados);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Reubicaciones_Pendientes");

    XLSX.writeFile(workbook, `productos_mal_ubicados_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

function setupEventListeners() {
    const modal = document.getElementById('uploadModal');
    const openBtn = document.getElementById('openModalBtn');
    const closeBtn = document.getElementById('closeModalBtn');
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');
    const exportBtn = document.getElementById('exportExcelBtn');

    openBtn.addEventListener('click', () => modal.classList.remove('hidden'));
    closeBtn.addEventListener('click', () => modal.classList.add('hidden'));
    dropZone.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) procesarArchivoWMS(e.target.files[0]);
    });

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('border-blue-500', 'bg-blue-50');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('border-blue-500', 'bg-blue-50');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('border-blue-500', 'bg-blue-50');
        if (e.dataTransfer.files.length > 0) {
            procesarArchivoWMS(e.dataTransfer.files[0]);
        }
    });

    exportBtn.addEventListener('click', exportarProductosMalUbicados);
    document.getElementById('areaFilter').addEventListener('change', processAndRenderTable);
    document.getElementById('pisoFilter').addEventListener('change', processAndRenderTable);
    document.getElementById('searchInput').addEventListener('input', processAndRenderTable);
}