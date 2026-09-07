// XML stencils for the shapes maxGraph has no built-in for: the stick-figure
// actor, the folded-corner note and the sequence lifeline, plus the basic
// geometry (pentagon, star, block arrow, ...) the built-in shape set stops
// short of. Coordinates are in each shape's own w/h units and scale with the
// cell.
export const STENCILS_XML = `<shapes>
  <shape name="uml-actor" aspect="fixed" w="40" h="70" strokewidth="inherit">
    <background>
      <ellipse x="12" y="0" w="16" h="16"/>
    </background>
    <foreground>
      <fillstroke/>
      <path>
        <move x="20" y="16"/><line x="20" y="42"/>
        <move x="2" y="24"/><line x="38" y="24"/>
        <move x="20" y="42"/><line x="4" y="70"/>
        <move x="20" y="42"/><line x="36" y="70"/>
      </path>
      <stroke/>
    </foreground>
  </shape>
  <shape name="uml-note" aspect="variable" w="100" h="60" strokewidth="inherit">
    <background>
      <path>
        <move x="0" y="0"/><line x="82" y="0"/><line x="100" y="18"/><line x="100" y="60"/><line x="0" y="60"/><close/>
      </path>
    </background>
    <foreground>
      <fillstroke/>
      <path>
        <move x="82" y="0"/><line x="82" y="18"/><line x="100" y="18"/>
      </path>
      <stroke/>
    </foreground>
  </shape>
  <shape name="uml-lifeline" aspect="variable" w="100" h="200" strokewidth="inherit">
    <background>
      <rect x="0" y="0" w="100" h="40"/>
    </background>
    <foreground>
      <fillstroke/>
      <dashed dashed="1"/>
      <path>
        <move x="50" y="40"/><line x="50" y="200"/>
      </path>
      <stroke/>
    </foreground>
  </shape>
  <shape name="basic-parallelogram" aspect="variable" w="100" h="60" strokewidth="inherit">
    <background>
      <path>
        <move x="20" y="0"/><line x="100" y="0"/><line x="80" y="60"/><line x="0" y="60"/><close/>
      </path>
    </background>
    <foreground><fillstroke/></foreground>
  </shape>
  <shape name="basic-trapezium" aspect="variable" w="100" h="60" strokewidth="inherit">
    <background>
      <path>
        <move x="20" y="0"/><line x="80" y="0"/><line x="100" y="60"/><line x="0" y="60"/><close/>
      </path>
    </background>
    <foreground><fillstroke/></foreground>
  </shape>
  <shape name="basic-pentagon" aspect="variable" w="100" h="95" strokewidth="inherit">
    <background>
      <path>
        <move x="50" y="0"/><line x="100" y="36"/><line x="81" y="95"/><line x="19" y="95"/><line x="0" y="36"/><close/>
      </path>
    </background>
    <foreground><fillstroke/></foreground>
  </shape>
  <shape name="basic-star" aspect="variable" w="100" h="95" strokewidth="inherit">
    <background>
      <path>
        <move x="50" y="0"/><line x="61" y="35"/><line x="98" y="35"/><line x="68" y="57"/><line x="79" y="92"/>
        <line x="50" y="70"/><line x="21" y="92"/><line x="32" y="57"/><line x="2" y="35"/><line x="39" y="35"/><close/>
      </path>
    </background>
    <foreground><fillstroke/></foreground>
  </shape>
  <shape name="basic-cross" aspect="variable" w="100" h="100" strokewidth="inherit">
    <background>
      <path>
        <move x="35" y="0"/><line x="65" y="0"/><line x="65" y="35"/><line x="100" y="35"/><line x="100" y="65"/>
        <line x="65" y="65"/><line x="65" y="100"/><line x="35" y="100"/><line x="35" y="65"/><line x="0" y="65"/>
        <line x="0" y="35"/><line x="35" y="35"/><close/>
      </path>
    </background>
    <foreground><fillstroke/></foreground>
  </shape>
  <shape name="basic-arrow" aspect="variable" w="100" h="60" strokewidth="inherit">
    <background>
      <path>
        <move x="0" y="15"/><line x="62" y="15"/><line x="62" y="0"/><line x="100" y="30"/><line x="62" y="60"/>
        <line x="62" y="45"/><line x="0" y="45"/><close/>
      </path>
    </background>
    <foreground><fillstroke/></foreground>
  </shape>
  <shape name="basic-callout" aspect="variable" w="100" h="80" strokewidth="inherit">
    <background>
      <path>
        <move x="0" y="0"/><line x="100" y="0"/><line x="100" y="60"/><line x="42" y="60"/><line x="24" y="80"/>
        <line x="24" y="60"/><line x="0" y="60"/><close/>
      </path>
    </background>
    <foreground><fillstroke/></foreground>
  </shape>
</shapes>`;
