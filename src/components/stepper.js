/* 步进器 · stepper
   对应 FL Studio 的 F6 通道机架。合并所有同时发声的鼓组（实测 48s 时同时有 kick + snare×2 + hihat×2 共 5 个 Pattern），按鼓件类别归并为行。零指针：不画指针线、不画列框；「现在」完全由绽放动画的余晖指示。未轮到的音符不显示，轮到时绽放、随后缓慢消 */

register({ id:'stepper', name:'步进器', w:960, h:360, group:'结构',
  desc:'对应 FL Studio 的 F6 通道机架。<b>合并所有同时发声的鼓组</b>（实测 48s 时同时有 kick + snare×2 + hihat×2 共 5 个 Pattern），按鼓件类别归并为行。<b>零指针</b>：不画指针线、不画列框；「现在」完全由绽放动画的余晖指示。<b>未轮到的音符不显示</b>，轮到时绽放、随后缓慢消散；消散时长以「拍」为单位，故 BPM 越快消散越快。每个主题有自己的绽放语汇（见 BLOOM 模块）。',
  draw:function(g,w,h){
    /* 主题键由 activeThemeKey() 提供（构建时注入） */
    drawStepper(g, currentTheme(), activeThemeKey(), w, h, nowTick());
  }
});
