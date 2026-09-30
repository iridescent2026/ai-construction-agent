// ============================================================
// 工安智瞳 - 前端地图应用
// ============================================================

const API_BASE = 'http://127.0.0.1:8000';

// 危险区域颜色映射
const RISK_COLORS = {
    '高': '#e74c3c',
    '中': '#f39c12',
    '低': '#27ae60'
};

// ============================================================
// 1. 初始化地图
// ============================================================
const map = L.map('map', { zoomControl: true }).setView([30.2935, 120.0080], 18);

// 底图：Esri 卫星影像
const esriImagery = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19,
    attribution: 'Esri World Imagery'
}).addTo(map);

// 底图切换
const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: 'OpenStreetMap'
});
const googleSat = L.tileLayer('https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
    maxZoom: 19, attribution: 'Google Satellite'
});
L.control.layers({
    "Esri 卫星影像": esriImagery,
    "Google 卫星影像": googleSat,
    "OpenStreetMap": osm
}, null, { position: 'topleft' }).addTo(map);

// 比例尺
L.control.scale({ position: 'bottomright', imperial: false }).addTo(map);

// ============================================================
// 2. 模拟人员数据（与后端 all_people 对齐）
//    坐标使用完整版 GeoJSON 的坐标体系
// ============================================================
const people = [
    { person_id: 'P001', lng: 120.008, lat: 30.2945, name: '张三', role: '挖掘机操作员' },
    { person_id: 'P002', lng: 120.0100, lat: 30.2935, name: '李四', role: '吊装指挥' },
    { person_id: 'P003', lng: 120.011, lat: 30.292, name: '王五', role: '安全员' },
    { person_id: 'P004', lng: 120.008, lat: 30.2910, name: '赵六', role: '电工' },
    { person_id: 'P005', lng: 120.006, lat: 30.293, name: '孙七', role: '项目经理' }
];

// ============================================================
// 3. 加载本地 GeoJSON 并渲染危险区域
// ============================================================
let zoneLayer = null;
let personLayer = null;
let bufferLayer = null;

fetch('danger_zones.geojson')
    .then(res => res.json())
    .then(data => {
        // 渲染危险区域多边形
        zoneLayer = L.geoJSON(data, {
            style: feature => ({
                color: RISK_COLORS[feature.properties.risk_level] || '#999',
                weight: 3,
                fillColor: RISK_COLORS[feature.properties.risk_level] || '#999',
                fillOpacity: 0.3
            }),
            onEachFeature: (feature, layer) => {
                const p = feature.properties;
                layer.bindPopup(`
                    <div style="min-width:180px;">
                        <b style="font-size:15px;">${p.zone_id} - ${p.zone_type}</b><hr style="margin:4px 0;">
                        <b>区域编号：</b>${p.zone_id}<br>
                        <b>区域类型：</b>${p.zone_type}<br>
                        <b>风险等级：</b><span style="color:${RISK_COLORS[p.risk_level]}">${p.risk_level}</span><br>
                        ${p.buffer_radius ? `<b>缓冲半径：</b>${p.buffer_radius}米<br>` : ''}
                        ${p.alert ? `<b>预警：</b>${p.alert}` : ''}
                    </div>
                `);
            }
        }).addTo(map);

        // 渲染缓冲区圆圈
        bufferLayer = L.layerGroup();
        data.features.forEach(f => {
            const coords = f.geometry.coordinates[0];
            let lat = 0, lng = 0;
            for (let i = 0; i < coords.length - 1; i++) {
                lat += coords[i][1]; lng += coords[i][0];
            }
            lat /= (coords.length - 1); lng /= (coords.length - 1);
            const radius = f.properties.buffer_radius || 5;
            L.circle([lat, lng], {
                radius: radius,
                color: RISK_COLORS[f.properties.risk_level] || '#999',
                fillColor: RISK_COLORS[f.properties.risk_level] || '#999',
                fillOpacity: 0.08,
                dashArray: '8 4',
                weight: 2
            }).addTo(bufferLayer);
        });
        bufferLayer.addTo(map);

        // 缩放到所有区域
        map.fitBounds(zoneLayer.getBounds(), { padding: [50, 50] });
    })
    .catch(err => {
        console.error('GeoJSON 加载失败:', err);
        document.getElementById('zone-list').innerHTML = '<span style="color:#e74c3c;">GeoJSON 加载失败，请确认 danger_zones.geojson 在同目录下</span>';
    });

// ============================================================
// 4. 调用后端接口：批量判断人员状态
// ============================================================
function loadPeopleStatus() {
    const peopleSimple = people.map(p => ({
        person_id: p.person_id,
        lng: p.lng,
        lat: p.lat
    }));

    fetch(`${API_BASE}/check_danger_batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ people: peopleSimple })
    })
    .then(res => res.json())
    .then(data => {
        if (personLayer) personLayer.remove();
        personLayer = L.layerGroup();

        data.results.forEach(r => {
            const person = people.find(p => p.person_id === r.person_id);
            if (!person) return;

            const color = r.inside_zone ? '#e74c3c' : (r.in_buffer ? '#f39c12' : '#27ae60');
            const status = r.inside_zone ? '在危险区内' : (r.in_buffer ? '靠近危险区' : '安全');

            L.circleMarker([person.lat, person.lng], {
                radius: 10,
                color: '#fff',
                weight: 2,
                fillColor: color,
                fillOpacity: 0.9
            }).addTo(personLayer).bindPopup(`
                <div style="min-width:200px;">
                    <b style="font-size:15px;">${r.person_id} - ${person.name}</b><hr style="margin:4px 0;">
                    <b>人员编号：</b>${r.person_id}<br>
                    <b>姓名：</b>${person.name}<br>
                    <b>岗位：</b>${person.role}<br>
                    <b>状态：</b><span style="color:${color}">${status}</span><br>
                    ${r.zone_id ? `<b>所在区域：</b>${r.zone_id} ${r.zone_type || ''}<br>` : ''}
                    <b>风险等级：</b><span style="color:${RISK_COLORS[r.risk_level] || '#999'}">${r.risk_level}</span><br>
                    ${r.distance_to_boundary ? `<b>距边界：</b>${r.distance_to_boundary}度<br>` : ''}
                    <b>预警：</b>${r.alert}
                </div>
            `).bindTooltip(r.person_id, { permanent: false, direction: 'top', offset: [0, -12] });
        });

        personLayer.addTo(map);

        // 更新 API 状态
        document.getElementById('api-status-dot').className = 'dot dot-green';
        document.getElementById('api-status-text').textContent = '后端已连接';
    })
    .catch(err => {
        console.error('人员状态加载失败:', err);
        const isNetworkError = err.message && (err.message.includes('Failed to fetch') || err.message.includes('NetworkError'));
        if (isNetworkError) {
            document.getElementById('api-status-dot').className = 'dot dot-red';
            document.getElementById('api-status-text').textContent = '后端未连接（请启动 FastAPI）';
        }
        // 即使后端没连上，也显示人员点（灰色）
        if (personLayer) personLayer.remove();
        personLayer = L.layerGroup();
        people.forEach(person => {
            L.circleMarker([person.lat, person.lng], {
                radius: 10, color: '#fff', weight: 2,
                fillColor: '#999', fillOpacity: 0.6
            }).addTo(personLayer).bindPopup(`
                <b>${person.person_id} - ${person.name}</b><br>
                岗位：${person.role}<br>
                <i style="color:#999;">后端未连接，无法获取风险状态</i>
            `);
        });
        personLayer.addTo(map);
    });
}

// ============================================================
// 5. 调用后端接口：风险热力图 + 区域汇总
// ============================================================
function loadHeatmap() {
    fetch(`${API_BASE}/risk_heatmap`)
        .then(res => res.json())
        .then(data => {
            const panel = document.getElementById('zone-list');
            const riskClass = (level) => level === '高' ? 'high' : (level === '中' ? 'mid' : 'low');

            panel.innerHTML = data.heatmap.map(h => `
                <div class="zone-card ${riskClass(h.risk_level)}">
                    <div class="zone-title">${h.zone_id} ${h.zone_type}</div>
                    <div class="zone-row">风险等级：<span class="risk-${riskClass(h.risk_level)}">${h.risk_level}</span></div>
                    <div class="zone-row">区域内人数：${h.people_count}</div>
                    <div class="zone-row">风险评分：<b>${h.risk_score}</b></div>
                </div>
            `).join('');
        })
        .catch(err => {
            console.error('热力图加载失败:', err);
        });
}

// ============================================================
// 6. 图层控制
// ============================================================
setTimeout(() => {
    if (zoneLayer && bufferLayer && personLayer) {
        L.control.layers(null, {
            "危险区域": zoneLayer,
            "安全缓冲区": bufferLayer,
            "人员定位": personLayer
        }, { collapsed: false, position: 'bottomleft' }).addTo(map);
    }
}, 2000);

// ============================================================
// 7. 初始加载 + 定时刷新（每30秒）
// ============================================================
loadPeopleStatus();
loadHeatmap();
setInterval(() => {
    loadPeopleStatus();
    loadHeatmap();
}, 30000);
