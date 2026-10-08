// Examples fill the editor only. Import remains an explicit user action.
export function observationExample(kind) {
    const row=kind==='leave'?{id:'P023',x:-41,z:12}:kind==='temperature'?{id:'B-05',measurements:{temperature:{value:65,unit:'℃'}}}:{id:'P023',x:-28,z:23};
    return JSON.stringify({observations:[row]},null,2);
}

export function parseObservations(text) {
    let input;
    try { input=JSON.parse(text); } catch { throw new Error('JSON 格式不正确：请使用英文双引号，检查逗号和括号。'); }
    if(!input||!Array.isArray(input.observations)||!input.observations.length||input.observations.length>100)throw new Error('需要 observations 数组，每批 1–100 条观测。');
    const ids=new Set();
    for(const row of input.observations){
        if(!row||typeof row.id!=='string'||!row.id.trim())throw new Error('每条观测需要已有的人员或设备编号 id。');
        if(ids.has(row.id))throw new Error(`同批编号不能重复：${row.id}`);ids.add(row.id);
        const hasX=row.x!==undefined,hasZ=row.z!==undefined;
        if(hasX!==hasZ)throw new Error(`${row.id}：位置必须同时填写 x 和 z。`);
        if(hasX&&![row.x,row.z].every(v=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=1000))throw new Error(`${row.id}：x、z 应为 -1000 到 1000 的数字，单位米。`);
        if(!hasX&&(!row.measurements||!Object.keys(row.measurements).length))throw new Error(`${row.id}：请填写位置或设备 measurements。`);
    }
    return input;
}

export function importedSummary(result,rows) {
    return rows.map(row=>{
        const e=result.entities.find(item=>item.id===row.id);
        if(row.x===undefined)return `${row.id} 读数已更新（设备详情与分析页查看）`;
        const zones=(e?.currentZones||[]).map(id=>{const zone=result.entities.find(item=>item.id===id);return `${id} ${zone?.title||''}`.trim();});
        return `${row.id} (${row.x}, ${row.z}) · ${e?.riskState==='unknown'?'位置已过期，待核查':zones.length?'进入 '+zones.join('、'):'未进入限制区'}`;
    }).join('；');
}
