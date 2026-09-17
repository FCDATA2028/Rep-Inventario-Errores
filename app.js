// Credenciales Supabase
const SUPABASE_URL = "https://qaxxggokkclsfsjfmtbs.supabase.co";
const SUPABASE_KEY = "sb_publishable_xbiL5biH5Y9jUf9wfM-7Fg_C2TqshKs";
const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Memorias locales generales
let mapMaestroSKU = new Map();
let mapMaestroUbicacion = new Map();
let mapDetalleSKUMedida = new Map(); // Mapa para guardar SKU (codigo) -> Medida desde detalle_sku
let mapUMUbicacion = new Map();      // Mapa para guardar Medida -> PACK u UNIDAD desde um_ubicacion

let listEvaluaciones = [];
let listDesviados = [];
let listUbicacionesVacias = [];
let listResumenPasillos = [];
let listResumenCurvas = [];
let isMastersLoaded = false;

// Memoria exclusiva para Auditoría Pack / Unidad
let listPackUnidadEvaluados = [];
let packSortColumn = 'cantidad_paquete';
let packSortDirection = 'desc'; // Criterio inicial: mayor a menor (descendente)

// Claves de Persistencia Local
const STORAGE_PACK_KEY = 'cedis_pack_unidad_data';
const STORAGE_PACK_TIMESTAMP_KEY = 'cedis_pack_unidad_last_update';

// Variables Ordenamiento
let currentSortColumn = 'pasillo';
let currentSortDirection = 'asc';

let capSortColumn = 'totalPosiciones';
let capSortDirection = 'desc';

// Filtros Multiselect Activos
let selectedAreas = new Set();
let selectedCurvas = new Set();
let selectedPasillos = new Set();

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

/**
 * Función encargada de descomponer una cadena de ubicación en sus partes:
 * area, pasillo, bahia, nivel, posicion
 */
function desglosarUbicacion(ubiClean) {
    if (!ubiClean) {
        return { area: '', pasillo: '', bahia: '', nivel: '', posicion: '' };
    }

    const partes = ubiClean.split('-').map(p => p.trim()).filter(p => p.length > 0);

    let area = '';
    let pasillo = '';
    let bahia = '';
    let nivel = '';
    let posicion = '';

    if (partes.length >= 5) {
        area = partes[0];
        pasillo = partes[1];
        bahia = partes[2];
        nivel = partes[3];
        posicion = partes[4];
    } else if (partes.length === 4) {
        area = partes[0];
        pasillo = partes[1];
        bahia = partes[2];
        nivel = partes[3];
    } else if (partes.length === 3) {
        pasillo = partes[0];
        bahia = partes[1];
        nivel = partes[2];
    } else if (partes.length === 2) {
        pasillo = partes[0];
        bahia = partes[1];
    } else if (partes.length === 1) {
        pasillo = partes[0];
    }

    return { area, pasillo, bahia, nivel, posicion };
}

document.addEventListener('DOMContentLoaded', async () => {
    setupEventListeners();
    cargarPersistenciaPackUnidad();
    await cargarMaestrosSupabasePaginado();
    await cargarSnapshotDesdeSupabasePaginado();
});

async function cargarMaestrosSupabasePaginado() {
    try {
        // 1. Cargar Maestro SKU
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

        // 2. Cargar Maestro Ubicación
        let allUbicaciones = [];
        let fromUbi = 0;
        let stepUbi = 1000;
        let hasMoreUbi = true;

        while (hasMoreUbi) {
            const { data, error } = await _supabase
                .from('maestro_ubicacion')
                .select('ubicacion, curva_actual, pasillo, area, medida')
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
            const curva = item.curva_actual ? cleanString(item.curva_actual).toUpperCase() : 'SIN CURVA';
            const pasillo = item.pasillo ? String(item.pasillo).replace('.0', '').trim() : null;
            const area = item.area ? cleanString(item.area) : null;
            const medida = item.medida ? cleanString(item.medida).toUpperCase() : 'UNIDAD';

            if (ubiClean) {
                mapMaestroUbicacion.set(ubiClean, { curva, pasillo, area, medida });
            }
        });

        // 3. Cargar Detalle SKU para obtener la medida por Código de SKU
        let allDetalleSkus = [];
        let fromDet = 0;
        let stepDet = 1000;
        let hasMoreDet = true;

        while (hasMoreDet) {
            const { data, error } = await _supabase
                .from('detalle_sku')
                .select('codigo, medida')
                .range(fromDet, fromDet + stepDet - 1);

            if (error) throw error;
            if (data && data.length > 0) {
                allDetalleSkus.push(...data);
                fromDet += stepDet;
                if (data.length < stepDet) hasMoreDet = false;
            } else {
                hasMoreDet = false;
            }
        }

        mapDetalleSKUMedida.clear();
        allDetalleSkus.forEach(item => {
            const rawCodigo = cleanString(item.codigo);
            const cleanCodigo = cleanSKU(item.codigo);
            const medida = item.medida ? cleanString(item.medida).toUpperCase() : '';

            if (rawCodigo) mapDetalleSKUMedida.set(rawCodigo, medida);
            if (cleanCodigo) mapDetalleSKUMedida.set(cleanCodigo, medida);
        });

        // 4. Cargar Tabla um_ubicacion (Medida vs Ubicación: PACK / UNIDAD)
        let allUMUbi = [];
        let fromUM = 0;
        let stepUM = 1000;
        let hasMoreUM = true;

        while (hasMoreUM) {
            const { data, error } = await _supabase
                .from('um_ubicacion')
                .select('unidad_medida, ubicacion')
                .range(fromUM, fromUM + stepUM - 1);

            if (error) throw error;
            if (data && data.length > 0) {
                allUMUbi.push(...data);
                fromUM += stepUM;
                if (data.length < stepUM) hasMoreUM = false;
            } else {
                hasMoreUM = false;
            }
        }

        mapUMUbicacion.clear();
        allUMUbi.forEach(item => {
            const um = item.unidad_medida ? cleanString(item.unidad_medida).toUpperCase() : '';
            const ubiDestino = item.ubicacion ? cleanString(item.ubicacion).toUpperCase() : '';
            if (um) {
                mapUMUbicacion.set(um, ubiDestino);
            }
        });

        isMastersLoaded = true;

    } catch (err) {
        console.error("Error al cargar maestros:", err);
    }
}

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

function reconstruirResumenYRenderizar() {
    const agrupadoPasillo = new Map();
    let totalSKUsSet = new Set();
    let totalLPNsSum = 0;
    let totalUnidadesSum = 0;

    let lineasTotalesEvaluadas = listEvaluaciones.length;
    let lineasCumplidas = 0;
    let lineasDesviadas = 0;

    const ocupacionPorUbicacion = new Map();

    listEvaluaciones.forEach(item => {
        if (item.sku) totalSKUsSet.add(item.sku);
        totalLPNsSum += parseNum(item.lpn_actual);
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
        pasData.totalLPNs += parseNum(item.lpn_actual);
        pasData.stockActual += parseNum(item.cantidad_actual);
        pasData.lineasTotales++;

        if (esConforme) pasData.lineasConformes++;
        else pasData.lineasDesviadas++;

        if (item.ubicacion) {
            const ubiClean = cleanUbicacion(item.ubicacion);
            if (!ocupacionPorUbicacion.has(ubiClean)) {
                ocupacionPorUbicacion.set(ubiClean, {
                    skusSet: new Set(),
                    totalLPNs: 0
                });
            }
            const infoUbi = ocupacionPorUbicacion.get(ubiClean);
            if (item.sku) infoUbi.skusSet.add(item.sku);
            infoUbi.totalLPNs += parseNum(item.lpn_actual);
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

    // VISTA 2 CONSTRUCTOR
    const agrupadoCurvaNivelBahia = new Map();
    const ocupacionPorCurvaGlobal = new Map();
    const ocupacionPorSubAreaGlobal = new Map();
    listUbicacionesVacias = [];

    mapMaestroUbicacion.forEach((val, ubiClean) => {
        const curva = val.curva || 'SIN CURVA';
        let area = val.area;
        if (!area) {
            area = ubiClean.startsWith('A2') || ubiClean.includes('AIP02') ? 'AIP02' : 'AIP01';
        }

        const pasilloNum = parseNum(val.pasillo);
        let piso = 'Planta Baja';

        if (area === 'AIP01') {
            if (pasilloNum >= 201 && pasilloNum <= 228) piso = 'Planta Alta';
        } else if (area === 'AIP02') {
            if ((pasilloNum >= 301 && pasilloNum <= 308) || (pasilloNum >= 401 && pasilloNum <= 408)) piso = 'Piso 1';
            else if ((pasilloNum >= 501 && pasilloNum <= 508) || (pasilloNum >= 601 && pasilloNum <= 608)) piso = 'Piso 2';
        }

        const subAreaKey = `${area} - ${piso}`;

        const partes = ubiClean.split('-');
        let bahia = 'N/A';
        let nivel = 'N/A';

        if (partes.length >= 3) {
            bahia = partes[1].trim();
            nivel = partes[2].trim();
        } else if (partes.length === 2) {
            bahia = partes[1].trim();
        }

        const compositeKey = `${area}|${val.pasillo}|${curva}|${nivel}|${bahia}`;

        if (!agrupadoCurvaNivelBahia.has(compositeKey)) {
            agrupadoCurvaNivelBahia.set(compositeKey, {
                area: area,
                pasillo: val.pasillo || 'N/A',
                curva: curva,
                nivel: nivel,
                bahia: bahia,
                totalPosiciones: 0,
                posicionesVacias: 0,
                posicionesOcupadas: 0,
                monoproducto: 0,
                mezcladas: 0,
                totalLPNs: 0
            });
        }

        const cData = agrupadoCurvaNivelBahia.get(compositeKey);
        cData.totalPosiciones++;

        if (!ocupacionPorCurvaGlobal.has(curva)) {
            ocupacionPorCurvaGlobal.set(curva, { total: 0, ocupadas: 0, vacias: 0 });
        }
        const curRes = ocupacionPorCurvaGlobal.get(curva);
        curRes.total++;

        if (!ocupacionPorSubAreaGlobal.has(subAreaKey)) {
            ocupacionPorSubAreaGlobal.set(subAreaKey, { area, piso, total: 0, ocupadas: 0, vacias: 0 });
        }
        const subAreaRes = ocupacionPorSubAreaGlobal.get(subAreaKey);
        subAreaRes.total++;

        const ocupacion = ocupacionPorUbicacion.get(ubiClean);
        if (!ocupacion || ocupacion.skusSet.size === 0) {
            cData.posicionesVacias++;
            curRes.vacias++;
            subAreaRes.vacias++;
            listUbicacionesVacias.push({
                ubicacion: ubiClean,
                area: area,
                pasillo: val.pasillo || 'N/A',
                bahia: bahia,
                nivel: nivel,
                curva_ubicacion: curva
            });
        } else {
            cData.posicionesOcupadas++;
            curRes.ocupadas++;
            subAreaRes.ocupadas++;
            cData.totalLPNs += ocupacion.totalLPNs;

            if (ocupacion.skusSet.size === 1) {
                cData.monoproducto++;
            } else if (ocupacion.skusSet.size > 1) {
                cData.mezcladas++;
            }
        }
    });

    listResumenCurvas = Array.from(agrupadoCurvaNivelBahia.values());
    poblarOpcionesFiltrosMultiselect();

    renderResumenTarjetas(ocupacionPorSubAreaGlobal, ocupacionPorCurvaGlobal);
    renderCapacidadModule();
}

function poblarOpcionesFiltrosMultiselect() {
    const curvasSet = new Set();
    const pasillosSet = new Set();

    listResumenCurvas.forEach(item => {
        if (item.curva) curvasSet.add(item.curva);
        if (item.pasillo && item.pasillo !== 'N/A') pasillosSet.add(item.pasillo);
    });

    const listCurvaBox = document.getElementById('listCurvaCheckboxes');
    const sortedCurvas = Array.from(curvasSet).sort();
    listCurvaBox.innerHTML = sortedCurvas.map(c => `
        <label class="flex items-center gap-2 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100 rounded cursor-pointer">
            <input type="checkbox" value="${c}" class="chk-curva-item rounded text-indigo-600 focus:ring-0"> Curva ${c}
        </label>
    `).join('');

    const listPasilloBox = document.getElementById('listPasilloCheckboxes');
    const sortedPasillos = Array.from(pasillosSet).sort((a, b) => parseNum(a) - parseNum(b));
    listPasilloBox.innerHTML = sortedPasillos.map(p => `
        <label class="flex items-center gap-2 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100 rounded cursor-pointer">
            <input type="checkbox" value="${p}" class="chk-pasillo-item rounded text-blue-600 focus:ring-0"> Pasillo ${p}
        </label>
    `).join('');

    setupMultiselectEvents();
}

function setupMultiselectEvents() {
    const chkAreaAll = document.getElementById('chkAreaAll');
    const areaItems = document.querySelectorAll('.chk-area-item');

    chkAreaAll.onchange = () => {
        areaItems.forEach(i => i.checked = false);
        selectedAreas.clear();
        updateFilterLabels();
        renderCapacidadModule();
    };

    areaItems.forEach(i => {
        i.onchange = () => {
            chkAreaAll.checked = false;
            selectedAreas.clear();
            areaItems.forEach(item => { if (item.checked) selectedAreas.add(item.value); });
            if (selectedAreas.size === 0) chkAreaAll.checked = true;
            updateFilterLabels();
            renderCapacidadModule();
        };
    });

    const chkCurvaAll = document.getElementById('chkCurvaAll');
    const curvaItems = document.querySelectorAll('.chk-curva-item');

    chkCurvaAll.onchange = () => {
        curvaItems.forEach(i => i.checked = false);
        selectedCurvas.clear();
        updateFilterLabels();
        renderCapacidadModule();
    };

    curvaItems.forEach(i => {
        i.onchange = () => {
            chkCurvaAll.checked = false;
            selectedCurvas.clear();
            curvaItems.forEach(item => { if (item.checked) selectedCurvas.add(item.value); });
            if (selectedCurvas.size === 0) chkCurvaAll.checked = true;
            updateFilterLabels();
            renderCapacidadModule();
        };
    });

    const chkPasilloAll = document.getElementById('chkPasilloAll');
    const pasilloItems = document.querySelectorAll('.chk-pasillo-item');

    chkPasilloAll.onchange = () => {
        pasilloItems.forEach(i => i.checked = false);
        selectedPasillos.clear();
        updateFilterLabels();
        renderCapacidadModule();
    };

    pasilloItems.forEach(i => {
        i.onchange = () => {
            chkPasilloAll.checked = false;
            selectedPasillos.clear();
            pasilloItems.forEach(item => { if (item.checked) selectedPasillos.add(item.value); });
            if (selectedPasillos.size === 0) chkPasilloAll.checked = true;
            updateFilterLabels();
            renderCapacidadModule();
        };
    });
}

function updateFilterLabels() {
    const btnArea = document.querySelector('#btnFilterArea span');
    const btnCurva = document.querySelector('#btnFilterCurva span');
    const btnPasillo = document.querySelector('#btnFilterPasillo span');

    btnArea.textContent = selectedAreas.size === 0 ? "Área: Todas" : `Área: (${selectedAreas.size})`;
    btnCurva.textContent = selectedCurvas.size === 0 ? "Curva: Todas" : `Curva: (${selectedCurvas.size})`;
    btnPasillo.textContent = selectedPasillos.size === 0 ? "Pasillos: Todos" : `Pasillos: (${selectedPasillos.size})`;
}

function renderResumenTarjetas(mapSubArea, mapCurva) {
    const summaryAreaContainer = document.getElementById('summaryAreaContainer');
    const summaryCurvaContainer = document.getElementById('summaryCurvaContainer');

    let htmlArea = '';
    const sortedSubAreas = Array.from(mapSubArea.keys()).sort();

    sortedSubAreas.forEach(subKey => {
        const val = mapSubArea.get(subKey);
        const pct = val.total > 0 ? ((val.ocupadas / val.total) * 100).toFixed(1) : '0.0';
        htmlArea += `
            <div class="bg-slate-50 border border-slate-200 rounded-lg p-3 flex flex-col justify-between shadow-xs">
                <div class="flex justify-between items-center mb-1.5">
                    <span class="text-xs font-bold text-slate-800">${subKey}</span>
                    <span class="text-[10px] font-extrabold text-blue-900 bg-blue-100 px-2 py-0.5 rounded-full">${pct}%</span>
                </div>
                <div class="w-full bg-slate-200 h-2 rounded-full overflow-hidden mb-2">
                    <div class="bg-blue-600 h-full rounded-full transition-all duration-300" style="width: ${pct}%"></div>
                </div>
                <p class="text-[11px] text-slate-500 font-medium">
                    Ocupadas: <strong class="text-slate-900 font-bold">${val.ocupadas.toLocaleString('es-ES')}</strong> de ${val.total.toLocaleString('es-ES')}
                </p>
            </div>
        `;
    });
    summaryAreaContainer.innerHTML = htmlArea || `<p class="text-xs text-slate-400">Sin datos de áreas.</p>`;

    const sortedCurvasKey = Array.from(mapCurva.keys()).sort();
    let htmlCurva = '';
    sortedCurvasKey.forEach(curvaKey => {
        const val = mapCurva.get(curvaKey);
        const pct = val.total > 0 ? ((val.ocupadas / val.total) * 100).toFixed(1) : '0.0';
        htmlCurva += `
            <div class="bg-slate-50 border border-slate-200 rounded-xl p-3.5 flex flex-col justify-between shadow-xs hover:border-indigo-300 transition-all h-full">
                <div class="flex justify-between items-center mb-2">
                    <span class="text-xs font-bold text-slate-800 tracking-tight">Curva ${curvaKey}</span>
                    <span class="text-[10px] font-extrabold text-indigo-900 bg-indigo-100 px-2 py-0.5 rounded-md">${pct}%</span>
                </div>
                <div class="my-auto">
                    <div class="w-full bg-slate-200 h-2 rounded-full overflow-hidden mb-2">
                        <div class="bg-indigo-600 h-full rounded-full transition-all duration-300" style="width: ${pct}%"></div>
                    </div>
                </div>
                <p class="text-[11px] text-slate-500 font-medium pt-1">
                    <strong class="text-slate-900 font-bold">${val.ocupadas.toLocaleString('es-ES')}</strong> de ${val.total.toLocaleString('es-ES')}
                </p>
            </div>
        `;
    });
    summaryCurvaContainer.innerHTML = htmlCurva || `<p class="text-xs text-slate-400">Sin datos de curvas.</p>`;
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
    const thead = document.querySelector('#viewPasillos table thead');
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
            <th class="p-3 text-center cursor-pointer" onclick="changeSort('% Cumplimiento')">% Cumplimiento${getArrow('pct_cumplimiento')}</th>
        </tr>
    `;
}

function renderCapacidadModule() {
    let filteredCurvas = listResumenCurvas.filter(item => {
        const matchArea = selectedAreas.size === 0 || selectedAreas.has(item.area);
        const matchCurva = selectedCurvas.size === 0 || selectedCurvas.has(item.curva);
        const matchPasillo = selectedPasillos.size === 0 || selectedPasillos.has(item.pasillo);
        return matchArea && matchCurva && matchPasillo;
    });

    let totPos = 0;
    let totVacias = 0;
    let totOcupadas = 0;
    let totMonoproducto = 0;
    let totMezcladas = 0;

    filteredCurvas.forEach(c => {
        totPos += c.totalPosiciones;
        totVacias += c.posicionesVacias;
        totOcupadas += c.posicionesOcupadas;
        totMonoproducto += c.monoproducto;
        totMezcladas += c.mezcladas;
    });

    const pctGlobalOcupacion = totPos > 0 ? ((totOcupadas / totPos) * 100).toFixed(1) : '0.0';

    document.getElementById('kpi-capacidad-total').textContent = totPos.toLocaleString('es-ES');
    document.getElementById('kpi-capacidad-vacias').textContent = totVacias.toLocaleString('es-ES');
    document.getElementById('kpi-capacidad-ocupadas').textContent = totOcupadas.toLocaleString('es-ES');
    document.getElementById('kpi-capacidad-monoproducto').textContent = totMonoproducto.toLocaleString('es-ES');
    document.getElementById('kpi-capacidad-mezcladas').textContent = totMezcladas.toLocaleString('es-ES');
    document.getElementById('kpi-capacidad-pct').textContent = `${pctGlobalOcupacion}%`;

    const tableBodyCap = document.getElementById('tableBodyCapacidad');

    let sortedCurvasList = [...filteredCurvas].sort((a, b) => {
        let valA, valB;

        if (capSortColumn === 'pct_ocupacion') {
            valA = a.totalPosiciones > 0 ? (a.posicionesOcupadas / a.totalPosiciones) * 100 : 0;
            valB = b.totalPosiciones > 0 ? (b.posicionesOcupadas / b.totalPosiciones) * 100 : 0;
        } else {
            valA = a[capSortColumn];
            valB = b[capSortColumn];
        }

        const isNumeric = typeof valA === 'number';

        if (isNumeric) {
            return capSortDirection === 'asc' ? valA - valB : valB - valA;
        } else {
            valA = String(valA || '').toLowerCase();
            valB = String(valB || '').toLowerCase();
            return capSortDirection === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        }
    });

    renderCapacidadHeaders();

    const vaciasFiltradas = getVaciasFiltradas();
    document.getElementById('exportVaciasBtn').disabled = vaciasFiltradas.length === 0;

    if (sortedCurvasList.length === 0) {
        tableBodyCap.innerHTML = `<tr><td colspan="10" class="p-8 text-center text-slate-500 font-medium">No hay ubicaciones que coincidan con los filtros seleccionados.</td></tr>`;
        return;
    }

    tableBodyCap.innerHTML = sortedCurvasList.map(c => {
        const pct = c.totalPosiciones > 0 ? (c.posicionesOcupadas / c.totalPosiciones) * 100 : 0;

        let badgeColor = 'bg-emerald-100 text-emerald-800 border-emerald-300';
        if (pct >= 90) badgeColor = 'bg-rose-100 text-rose-800 border-rose-300';
        else if (pct >= 75) badgeColor = 'bg-amber-100 text-amber-800 border-amber-300';

        return `
        <tr class="hover:bg-blue-50/50 transition-colors border-b border-slate-200">
            <td class="p-3 font-bold text-slate-900">Curva ${c.curva}</td>
            <td class="p-3 text-center font-medium text-slate-700">${c.nivel}</td>
            <td class="p-3 text-center font-medium text-slate-700">${c.bahia}</td>
            <td class="p-3 text-right font-medium text-slate-700">${c.totalPosiciones.toLocaleString('es-ES')}</td>
            <td class="p-3 text-right font-bold text-emerald-600">${c.posicionesVacias.toLocaleString('es-ES')}</td>
            <td class="p-3 text-right font-bold text-blue-900">${c.posicionesOcupadas.toLocaleString('es-ES')}</td>
            <td class="p-3 text-right font-medium text-indigo-700">${c.monoproducto.toLocaleString('es-ES')}</td>
            <td class="p-3 text-right font-bold text-amber-600">${c.mezcladas.toLocaleString('es-ES')}</td>
            <td class="p-3 text-right font-semibold text-slate-800">${c.totalLPNs.toLocaleString('es-ES')}</td>
            <td class="p-3 text-center font-bold">
                <span class="inline-block px-2.5 py-0.5 rounded-full text-[11px] border ${badgeColor}">
                    ${pct.toFixed(1)}%
                </span>
            </td>
        </tr>
    `}).join('');
}

function renderCapacidadHeaders() {
    const thead = document.querySelector('#viewCapacidad table thead');
    const getArrow = (col) => (capSortColumn === col ? (capSortDirection === 'asc' ? ' ▲' : ' ▼') : ' ⇅');

    thead.innerHTML = `
        <tr>
            <th class="p-3 cursor-pointer hover:bg-slate-200" onclick="changeCapSort('curva')">Curva${getArrow('curva')}</th>
            <th class="p-3 text-center cursor-pointer hover:bg-slate-200" onclick="changeCapSort('nivel')">Nivel${getArrow('nivel')}</th>
            <th class="p-3 text-center cursor-pointer hover:bg-slate-200" onclick="changeCapSort('bahia')">Bahía${getArrow('bahia')}</th>
            <th class="p-3 text-right cursor-pointer hover:bg-slate-200" onclick="changeCapSort('totalPosiciones')">Total Posiciones${getArrow('totalPosiciones')}</th>
            <th class="p-3 text-right cursor-pointer hover:bg-slate-200 text-emerald-700" onclick="changeCapSort('posicionesVacias')">Posiciones Vacías${getArrow('posicionesVacias')}</th>
            <th class="p-3 text-right cursor-pointer hover:bg-slate-200 text-blue-900" onclick="changeCapSort('posicionesOcupadas')">Posiciones Ocupadas${getArrow('posicionesOcupadas')}</th>
            <th class="p-3 text-right cursor-pointer hover:bg-slate-200 text-indigo-700" onclick="changeCapSort('monoproducto')">Monoproducto (1 SKU)${getArrow('monoproducto')}</th>
            <th class="p-3 text-right cursor-pointer hover:bg-slate-200 text-amber-700" onclick="changeCapSort('mezcladas')">Mezcladas (2+ SKUs)${getArrow('mezcladas')}</th>
            <th class="p-3 text-right cursor-pointer hover:bg-slate-200" onclick="changeCapSort('totalLPNs')">Total LPNs${getArrow('totalLPNs')}</th>
            <th class="p-3 text-center cursor-pointer hover:bg-slate-200" onclick="changeCapSort('pct_ocupacion')">% Ocupación${getArrow('pct_ocupacion')}</th>
        </tr>
    `;
}

window.changeCapSort = function (column) {
    if (capSortColumn === column) {
        capSortDirection = capSortDirection === 'desc' ? 'asc' : 'desc';
    } else {
        capSortColumn = column;
        capSortDirection = 'desc';
    }
    renderCapacidadModule();
};

window.changeSort = function (column) {
    if (currentSortColumn === column) {
        currentSortDirection = currentSortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        currentSortColumn = column;
        currentSortDirection = 'desc';
    }
    processAndRenderTable();
};

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

function getVaciasFiltradas() {
    return listUbicacionesVacias.filter(item => {
        const matchArea = selectedAreas.size === 0 || selectedAreas.has(item.area);
        const matchCurva = selectedCurvas.size === 0 || selectedCurvas.has(item.curva_ubicacion);
        const matchPasillo = selectedPasillos.size === 0 || selectedPasillos.has(item.pasillo);
        return matchArea && matchCurva && matchPasillo;
    });
}

function exportarUbicacionesVacias() {
    const vaciasFiltradas = getVaciasFiltradas();

    if (!vaciasFiltradas || vaciasFiltradas.length === 0) {
        alert("No hay posiciones vacías que coincidan con los filtros activos para exportar.");
        return;
    }

    const sortedVacias = [...vaciasFiltradas].sort((a, b) => a.ubicacion.localeCompare(b.ubicacion));

    const worksheet = XLSX.utils.json_to_sheet(sortedVacias);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Ubicaciones_Vacias_Filtradas");

    XLSX.writeFile(workbook, `ubicaciones_vacias_filtradas_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// -------------------------------------------------------------
// LÓGICA EXCLUSIVA DEL APARTADO: AUDITORÍA PACK / UNIDAD
// -------------------------------------------------------------

function procesarArchivoPackUnidad(file) {
    const loadingOverlay = document.getElementById('packLoadingOverlay');
    if (loadingOverlay) loadingOverlay.classList.remove('hidden');

    setTimeout(() => {
        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            encoding: "latin1",
            complete: async function (results) {
                await evaluarGuardarPackUnidad(results.data);
                actualizarMarcaDeAguaFecha();
                if (loadingOverlay) loadingOverlay.classList.add('hidden');
            },
            error: function (err) {
                alert("Error al leer el CSV para Pack/Unidad: " + err);
                if (loadingOverlay) loadingOverlay.classList.add('hidden');
            }
        });
    }, 50);
}

async function evaluarGuardarPackUnidad(rows) {
    if (!rows || rows.length === 0) return;

    if (mapMaestroUbicacion.size === 0 || mapDetalleSKUMedida.size === 0 || mapUMUbicacion.size === 0) {
        await cargarMaestrosSupabasePaginado();
    }

    const keys = Object.keys(rows[0]);

    // Identificación de columnas
    const colLpnKey = keys[0];        // Columna 1: Nro LPN
    const colSkuKey = keys[2];        // Columna 3: Cod Alternat (SKU)
    const colDescKey = keys[4];       // Columna 5: Descripcion
    const colCantPaqKey = keys[9];    // Columna 10: Cantidad de paquete
    const colUbiKey = keys[10];       // Columna 11: Ubicacion

    let insertPayload = [];
    listPackUnidadEvaluados = [];

    rows.forEach(row => {
        const cantPaquete = parseNum(row[colCantPaqKey]);

        // REGLA: Si la cantidad de paquete es 0, ignorar completamente
        if (cantPaquete <= 0) return;

        const ubicacion = cleanUbicacion(row[colUbiKey]);
        const ubiInfo = mapMaestroUbicacion.get(ubicacion);

        const lpn = cleanString(row[colLpnKey]);
        const skuRaw = cleanString(row[colSkuKey]);
        const skuClean = cleanSKU(skuRaw);
        const descripcion = cleanString(row[colDescKey]);

        // Desglose de ubicación
        const ubiParts = desglosarUbicacion(ubicacion);
        let areaFisica = ubiParts.area || (ubiInfo ? ubiInfo.area : '') || 'REVISAR';

        // 1. OBTENER ZONA ACTUAL (desde maestro_ubicacion)
        const zonaActual = ubiInfo && ubiInfo.medida ? ubiInfo.medida.toUpperCase() : 'UNIDAD';

        // 2. VERIFICAR SI EL SKU EXISTE EN detalle_sku Y OBTENER UNIDAD DE MEDIDA / ZONA REQUERIDA
        const existeEnDetalleSKU = mapDetalleSKUMedida.has(skuRaw) || mapDetalleSKUMedida.has(skuClean);
        let unidadMedida = '';
        let zonaRequerida = '';

        if (existeEnDetalleSKU) {
            // Si está en detalle_sku, tomamos la unidad de medida mapeada
            unidadMedida = mapDetalleSKUMedida.get(skuRaw) || mapDetalleSKUMedida.get(skuClean) || 'SIN MEDIDA';

            // La zona requerida se busca en um_ubicacion mediante su unidad_medida
            zonaRequerida = mapUMUbicacion.get(unidadMedida.toUpperCase()) || 'UNIDAD';
        } else {
            // Si NO está en detalle_sku:
            // Regla: 1 -> UNIDAD, >1 -> PACK
            const medidaDerivada = cantPaquete > 1 ? 'PACK' : 'UNIDAD';
            unidadMedida = medidaDerivada;

            // Su Zona Requerida será exactamente la misma que sale en su medida
            zonaRequerida = medidaDerivada;
        }

        // 3. DETERMINAR ESTADO DE AUDITORÍA
        // Compara si la Zona Actual donde está la ubicación física es la que requiere el producto
        let estadoAuditoria = (zonaActual.toUpperCase() === zonaRequerida.toUpperCase()) ? 'CORRECTO' : 'DESUBICADO';

        const itemEval = {
            nro_lpn: lpn,
            cod_alternat: skuRaw,
            descripcion: descripcion,
            cantidad_paquete: cantPaquete,
            unidad_medida: unidadMedida,
            ubicacion: ubicacion,
            area: areaFisica,
            pasillo: ubiParts.pasillo || (ubiInfo ? ubiInfo.pasillo : ''),
            bahia: ubiParts.bahia || '',
            nivel: ubiParts.nivel || '',
            posicion: ubiParts.posicion || '',
            zona_ubicacion: zonaActual,
            zona_requerida: zonaRequerida,
            estado: estadoAuditoria
        };

        listPackUnidadEvaluados.push(itemEval);

        insertPayload.push({
            nro_lpn: lpn,
            cod_alternat: skuRaw,
            descripcion: descripcion,
            cantidad_paquete: String(cantPaquete),
            ubicacion: ubicacion
        });
    });

    // Guardar en Supabase en la tabla lpn_entra
    try {
        await _supabase.from('lpn_entra').delete().neq('id', 0);
        if (insertPayload.length > 0) {
            const batchSize = 1000;
            for (let i = 0; i < insertPayload.length; i += batchSize) {
                const batch = insertPayload.slice(i, i + batchSize);
                await _supabase.from('lpn_entra').insert(batch);
            }
        }
    } catch (err) {
        console.error("Error al sincronizar lpn_entra en Supabase:", err);
    }

    // Persistir estado en LocalStorage
    guardarPersistenciaPackUnidad();

    renderTablaPackUnidad();
}

function renderTablaPackUnidadHeaders() {
    const thead = document.querySelector('#viewPackUnidad table thead');
    const getArrow = (col) => (packSortColumn === col ? (packSortDirection === 'asc' ? ' ▲' : ' ▼') : ' ⇅');

    thead.innerHTML = `
        <tr>
            <th class="p-2.5 cursor-pointer hover:bg-slate-200 transition-colors" onclick="sortPackByColumn('nro_lpn')">Nro LPN${getArrow('nro_lpn')}</th>
            <th class="p-2.5 cursor-pointer hover:bg-slate-200 transition-colors" onclick="sortPackByColumn('cod_alternat')">Código SKU${getArrow('cod_alternat')}</th>
            <th class="p-2.5 cursor-pointer hover:bg-slate-200 transition-colors" onclick="sortPackByColumn('descripcion')">Descripción Producto${getArrow('descripcion')}</th>
            <th class="p-2.5 text-center cursor-pointer hover:bg-slate-200 transition-colors" onclick="sortPackByColumn('cantidad_paquete')">Cant. Paquete${getArrow('cantidad_paquete')}</th>
            <th class="p-2.5 text-center cursor-pointer hover:bg-slate-200 transition-colors" onclick="sortPackByColumn('unidad_medida')">Unidad Medida${getArrow('unidad_medida')}</th>
            <th class="p-2.5 cursor-pointer hover:bg-slate-200 transition-colors" onclick="sortPackByColumn('ubicacion')">Ubicación Completa${getArrow('ubicacion')}</th>
            <th class="p-2.5 text-center cursor-pointer hover:bg-slate-200 transition-colors" onclick="sortPackByColumn('area')">Área${getArrow('area')}</th>
            <th class="p-2.5 text-center cursor-pointer hover:bg-slate-200 transition-colors" onclick="sortPackByColumn('pasillo')">Pasillo${getArrow('pasillo')}</th>
            <th class="p-2.5 text-center cursor-pointer hover:bg-slate-200 transition-colors" onclick="sortPackByColumn('bahia')">Bahía${getArrow('bahia')}</th>
            <th class="p-2.5 text-center cursor-pointer hover:bg-slate-200 transition-colors" onclick="sortPackByColumn('nivel')">Nivel${getArrow('nivel')}</th>
            <th class="p-2.5 text-center cursor-pointer hover:bg-slate-200 transition-colors" onclick="sortPackByColumn('posicion')">Posición${getArrow('posicion')}</th>
            <th class="p-2.5 text-center cursor-pointer hover:bg-slate-200 transition-colors" onclick="sortPackByColumn('zona_ubicacion')">Zona Actual${getArrow('zona_ubicacion')}</th>
            <th class="p-2.5 text-center cursor-pointer hover:bg-slate-200 transition-colors" onclick="sortPackByColumn('zona_requerida')">Zona Requerida${getArrow('zona_requerida')}</th>
            <th class="p-2.5 text-center cursor-pointer hover:bg-slate-200 transition-colors" onclick="sortPackByColumn('estado')">Estado Auditoría${getArrow('estado')}</th>
        </tr>
    `;
}

window.sortPackByColumn = function (columnKey) {
    if (packSortColumn === columnKey) {
        packSortDirection = packSortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        packSortColumn = columnKey;
        packSortDirection = 'desc';
    }
    renderTablaPackUnidad();
};

function renderTablaPackUnidad() {
    const total = listPackUnidadEvaluados.length;
    let correctos = 0;
    let desubicados = 0;

    listPackUnidadEvaluados.forEach(item => {
        if (item.estado === 'CORRECTO') correctos++;
        else desubicados++;
    });

    const pct = total > 0 ? ((correctos / total) * 100).toFixed(1) : '0.0';

    document.getElementById('kpi-pack-total').textContent = total.toLocaleString('es-ES');
    document.getElementById('kpi-pack-correctos').textContent = correctos.toLocaleString('es-ES');
    document.getElementById('kpi-pack-desubicados').textContent = desubicados.toLocaleString('es-ES');
    document.getElementById('kpi-pack-pct').textContent = `${pct}%`;

    document.getElementById('packCountStatus').textContent = `${total} LPNs procesados`;
    document.getElementById('btnExportPackUnidad').disabled = total === 0;

    renderTablaPackUnidadHeaders();

    const tbody = document.getElementById('tableBodyPackUnidad');

    if (total === 0) {
        tbody.innerHTML = `<tr><td colspan="14" class="p-8 text-center text-slate-500 font-medium">No se encontraron registros de LPNs.</td></tr>`;
        return;
    }

    // Ordenamiento por columna dinámica
    const sortedList = [...listPackUnidadEvaluados].sort((a, b) => {
        let valA = a[packSortColumn];
        let valB = b[packSortColumn];

        if (typeof valA === 'number' || !isNaN(valA) && valA !== '') {
            valA = parseNum(valA);
            valB = parseNum(valB);
            return packSortDirection === 'asc' ? valA - valB : valB - valA;
        } else {
            valA = String(valA || '').toLowerCase();
            valB = String(valB || '').toLowerCase();
            return packSortDirection === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        }
    });

    tbody.innerHTML = sortedList.map(item => {
        let badgeClass = 'bg-rose-100 text-rose-800 border-rose-300 font-bold';
        if (item.estado === 'CORRECTO') {
            badgeClass = 'bg-emerald-100 text-emerald-800 border-emerald-300';
        } else if (item.estado.includes('ALERTA') || item.estado.includes('ESPECIAL')) {
            badgeClass = 'bg-amber-100 text-amber-800 border-amber-300 font-bold';
        }

        return `
            <tr class="hover:bg-blue-50/50 transition-colors border-b border-slate-200">
                <td class="p-2.5 font-semibold text-slate-900">${item.nro_lpn}</td>
                <td class="p-2.5 font-medium text-blue-900">${item.cod_alternat}</td>
                <td class="p-2.5 font-medium text-slate-700">${item.descripcion}</td>
                <td class="p-2.5 text-center font-bold text-slate-800 bg-slate-50/60">${item.cantidad_paquete}</td>
                <td class="p-2.5 text-center font-bold text-indigo-900 bg-indigo-50/40">${item.unidad_medida}</td>
                <td class="p-2.5 font-semibold text-slate-800">${item.ubicacion}</td>
                <td class="p-2.5 text-center font-medium text-slate-600">${item.area}</td>
                <td class="p-2.5 text-center font-medium text-slate-600">${item.pasillo}</td>
                <td class="p-2.5 text-center font-medium text-slate-600">${item.bahia}</td>
                <td class="p-2.5 text-center font-medium text-slate-600">${item.nivel}</td>
                <td class="p-2.5 text-center font-medium text-slate-600">${item.posicion}</td>
                <td class="p-2.5 text-center font-medium text-slate-600">${item.zona_ubicacion}</td>
                <td class="p-2.5 text-center font-bold text-indigo-700">${item.zona_requerida}</td>
                <td class="p-2.5 text-center">
                    <span class="inline-block px-2.5 py-0.5 rounded-full text-[11px] border ${badgeClass}">
                        ${item.estado}
                    </span>
                </td>
            </tr>
        `;
    }).join('');
}

function guardarPersistenciaPackUnidad() {
    try {
        localStorage.setItem(STORAGE_PACK_KEY, JSON.stringify(listPackUnidadEvaluados));
        const nowFormatted = new Date().toLocaleString('es-ES', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit', second: '2-digit'
        });
        localStorage.setItem(STORAGE_PACK_TIMESTAMP_KEY, nowFormatted);
    } catch (e) {
        console.warn("No se pudo guardar la persistencia en localStorage:", e);
    }
}

function cargarPersistenciaPackUnidad() {
    try {
        const savedData = localStorage.getItem(STORAGE_PACK_KEY);
        const savedTime = localStorage.getItem(STORAGE_PACK_TIMESTAMP_KEY);

        if (savedData) {
            listPackUnidadEvaluados = JSON.parse(savedData);
            renderTablaPackUnidad();
        }

        if (savedTime) {
            actualizarMarcaDeAguaFecha(savedTime);
        }
    } catch (e) {
        console.warn("Error al restaurar persistencia de Pack/Unidad:", e);
    }
}

function actualizarMarcaDeAguaFecha(fechaString = null) {
    const watermark = document.getElementById('packLastUpdateWatermark');
    if (!watermark) return;

    const fechaFinal = fechaString || new Date().toLocaleString('es-ES', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
    });

    watermark.innerHTML = `
        <svg class="w-3.5 h-3.5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
        </svg>
        Última actualización: <strong class="text-slate-800 ml-1">${fechaFinal}</strong>
    `;
    watermark.className = "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 shadow-2xs";
}

function exportarPackUnidadExcel() {
    if (!listPackUnidadEvaluados || listPackUnidadEvaluados.length === 0) {
        alert("No hay registros cargados para exportar.");
        return;
    }

    const exportData = listPackUnidadEvaluados.map(i => ({
        "NRO LPN": i.nro_lpn,
        "SKU": i.cod_alternat,
        "DESCRIPCION": i.descripcion,
        "CANTIDAD PAQUETE": i.cantidad_paquete,
        "UNIDAD DE MEDIDA": i.unidad_medida,
        "UBICACION COMPLETA": i.ubicacion,
        "AREA": i.area,
        "PASILLO": i.pasillo,
        "BAHIA": i.bahia,
        "NIVEL": i.nivel,
        "POSICION": i.posicion,
        "ZONA UBICACION ACTUAL": i.zona_ubicacion,
        "ZONA REQUERIDA": i.zona_requerida,
        "ESTADO AUDITORIA": i.estado
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Reporte_Auditoria_Empaque");

    XLSX.writeFile(workbook, "Pack unidad.xlsx");
}

function setupEventListeners() {
    const modal = document.getElementById('uploadModal');
    const openBtn = document.getElementById('openModalBtn');
    const closeBtn = document.getElementById('closeModalBtn');
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');
    const exportBtn = document.getElementById('exportExcelBtn');
    const exportVaciasBtn = document.getElementById('exportVaciasBtn');

    const navTabPasillos = document.getElementById('navTabPasillos');
    const navTabCapacidad = document.getElementById('navTabCapacidad');
    const navTabPackUnidad = document.getElementById('navTabPackUnidad');

    const viewPasillos = document.getElementById('viewPasillos');
    const viewCapacidad = document.getElementById('viewCapacidad');
    const viewPackUnidad = document.getElementById('viewPackUnidad');

    const topGlobalActions = document.getElementById('topGlobalActions');

    // NAVEGACIÓN Y CAMBIO DE VISTAS (AISLAMIENTO DE CONTROLES)
    navTabPasillos.addEventListener('click', () => {
        navTabPasillos.className = "px-3.5 py-1.5 rounded-lg bg-blue-900 text-white shadow-xs transition-all cursor-pointer";
        navTabCapacidad.className = "px-3.5 py-1.5 rounded-lg text-slate-600 hover:text-slate-900 transition-all cursor-pointer";
        navTabPackUnidad.className = "px-3.5 py-1.5 rounded-lg text-slate-600 hover:text-slate-900 transition-all cursor-pointer";

        viewPasillos.classList.remove('hidden');
        viewCapacidad.classList.add('hidden');
        viewPackUnidad.classList.add('hidden');

        topGlobalActions.classList.remove('hidden');
    });

    navTabCapacidad.addEventListener('click', () => {
        navTabCapacidad.className = "px-3.5 py-1.5 rounded-lg bg-blue-900 text-white shadow-xs transition-all cursor-pointer";
        navTabPasillos.className = "px-3.5 py-1.5 rounded-lg text-slate-600 hover:text-slate-900 transition-all cursor-pointer";
        navTabPackUnidad.className = "px-3.5 py-1.5 rounded-lg text-slate-600 hover:text-slate-900 transition-all cursor-pointer";

        viewCapacidad.classList.remove('hidden');
        viewPasillos.classList.add('hidden');
        viewPackUnidad.classList.add('hidden');

        topGlobalActions.classList.remove('hidden');
    });

    navTabPackUnidad.addEventListener('click', () => {
        navTabPackUnidad.className = "px-3.5 py-1.5 rounded-lg bg-blue-900 text-white shadow-xs transition-all cursor-pointer";
        navTabPasillos.className = "px-3.5 py-1.5 rounded-lg text-slate-600 hover:text-slate-900 transition-all cursor-pointer";
        navTabCapacidad.className = "px-3.5 py-1.5 rounded-lg text-slate-600 hover:text-slate-900 transition-all cursor-pointer";

        viewPackUnidad.classList.remove('hidden');
        viewPasillos.classList.add('hidden');
        viewCapacidad.classList.add('hidden');

        topGlobalActions.classList.add('hidden');
    });

    // EVENTOS ARCHIVO WMS GENERAL
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
    exportVaciasBtn.addEventListener('click', exportarUbicacionesVacias);

    // EVENTOS EXCLUSIVOS PACK / UNIDAD
    const btnUploadPackUnidad = document.getElementById('btnUploadPackUnidad');
    const filePackUnidadInput = document.getElementById('filePackUnidadInput');
    const btnExportPackUnidad = document.getElementById('btnExportPackUnidad');

    btnUploadPackUnidad.addEventListener('click', () => filePackUnidadInput.click());

    filePackUnidadInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            procesarArchivoPackUnidad(e.target.files[0]);
        }
    });

    btnExportPackUnidad.addEventListener('click', exportarPackUnidadExcel);

    // FILTROS
    document.getElementById('areaFilter').addEventListener('change', processAndRenderTable);
    document.getElementById('pisoFilter').addEventListener('change', processAndRenderTable);
    document.getElementById('searchInput').addEventListener('input', processAndRenderTable);

    // DESPLEGABLES
    const toggleDropdown = (btnId, menuId) => {
        const btn = document.getElementById(btnId);
        const menu = document.getElementById(menuId);
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            menu.classList.toggle('hidden');
        });
    };

    toggleDropdown('btnFilterArea', 'menuFilterArea');
    toggleDropdown('btnFilterCurva', 'menuFilterCurva');
    toggleDropdown('btnFilterPasillo', 'menuFilterPasillo');

    document.addEventListener('click', () => {
        document.getElementById('menuFilterArea').classList.add('hidden');
        document.getElementById('menuFilterCurva').classList.add('hidden');
        document.getElementById('menuFilterPasillo').classList.add('hidden');
    });

    document.querySelectorAll('#menuFilterArea, #menuFilterCurva, #menuFilterPasillo').forEach(m => {
        m.addEventListener('click', e => e.stopPropagation());
    });
}
