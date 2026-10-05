// Pure view rules shared by 2D, 3D, cards and tests.
(function (root) {
    const colors = {'高':'#ed5b67','中':'#edac45','低':'#29a98b','未知':'#8191a8'};
    const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    function fresh(record, now=Date.now()) {
        if(typeof record.timestamp!=='string' || !/(Z|[+-]\d{2}:\d{2})$/.test(record.timestamp))return false;
        const age=now-Date.parse(record.timestamp);
        return Number.isFinite(age) && age>=0 && age<=120000;
    }
    function deviceState(d,now) {
        const valid=['load','temperature','leakage','risk_score'].every(k=>typeof d[k]==='number' && Number.isFinite(d[k]));
        if(!valid || typeof d.alert!=='string' || !d.alert || !fresh(d,now) || d.status!=='online' || !['高','中','低'].includes(d.risk_level)) return {level:'未知',label:'状态未知',color:colors['未知']};
        const level=d.hard_alert?'高':d.risk_level;
        if(level==='低' && d.alert!=='正常') return {level:'中',label:'需关注',color:colors['中']};
        return {level,label:`${level}风险`,color:colors[level]};
    }
    function personState(p,result,now) {
        const level=fresh(p,now)?(result?.risk_level || '未知'):'未知';
        return {level,label:level==='未知'?'位置过期':level==='低'?'未命中高风险区':`${level}风险区域`,color:colors[level]||colors['未知']};
    }
    function localPoint(lng,lat) {
        return [(lng-120.008)*111320*Math.cos(30.293*Math.PI/180),(lat-30.293)*111320];
    }
    const api={colors,escape,fresh,deviceState,personState,localPoint};
    root.SiteUI=api;
    if(typeof module!=='undefined') module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
