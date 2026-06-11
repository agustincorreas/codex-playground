// Definición declarativa del formulario guiado.
// Cada paso tiene un `tipo` que resuelve a un componente en steps/.
// La `clave` es el nombre del campo dentro de respuestas (payload del motor).

export const MODOS = [
  {
    id: 'A',
    titulo: 'Amé un perfume',
    descripcion: 'Quiero algo similar',
    icono: 'heart',
    gratisIlimitado: true,
  },
  {
    id: 'B',
    titulo: 'Lo discontinuaron',
    descripcion: 'Busco reemplazarlo',
    icono: 'refresh',
    gratisIlimitado: true,
  },
  {
    id: 'C',
    titulo: 'Tengo una ocasión',
    descripcion: 'Necesito el perfume justo',
    icono: 'calendar',
    gratisIlimitado: false, // límite 5/día en tier gratuito
  },
  {
    id: 'D',
    titulo: 'Quiero regalar',
    descripcion: 'Es para otra persona',
    icono: 'gift',
    gratisIlimitado: false,
  },
];

const PRECIOS = ['Accesible', 'Medio', 'Premium', 'Nicho', 'Sin filtro'];
const MONEDAS = ['ARS', 'USD', 'EUR', 'CLP'];

export const WIZARDS = {
  A: [
    {
      tipo: 'busqueda',
      clave: 'perfume_referencia',
      titulo: '¿Cuál es ese perfume?',
      ayuda: 'Buscalo por nombre o marca. Si no aparece, escribilo igual: el matching será menos preciso.',
      permiteTextoLibre: true,
    },
    {
      tipo: 'chips',
      clave: 'que_gusto',
      titulo: '¿Qué es lo que más te gustó?',
      multiple: true,
      opciones: [
        'Sus notas de fondo', 'Su estela', 'Su duración', 'Su frescura',
        'Su calidez', 'Su intensidad', 'Su elegancia', 'Su rareza',
        'Su precio-performance', 'Su versatilidad',
      ],
    },
    {
      tipo: 'chips',
      clave: 'contextos',
      titulo: '¿En qué contexto lo usabas?',
      multiple: true,
      opciones: [
        'Trabajo', 'Salidas nocturnas', 'Uso diario', 'Verano', 'Invierno',
        'Deportes', 'Eventos formales', 'Romántico', 'Fin de semana',
      ],
    },
    {
      tipo: 'ajustes',
      clave: 'ajustes',
      titulo: 'Ajustá tu búsqueda',
      sliders: [
        { clave: 'similitud', label: 'Similitud', min: 1, max: 5, izq: 'Muy parecido', der: 'Diferente pero afín' },
        { clave: 'intensidad', label: 'Intensidad deseada', min: 1, max: 5, izq: 'Suave', der: 'Bestial' },
      ],
      precio: PRECIOS,
    },
    {
      tipo: 'texto',
      clave: 'exclusiones',
      titulo: '¿Algo que definitivamente no querés?',
      opcional: true,
      placeholder: 'Nada con pachulí / nada que huela a Sauvage / nada muy dulce',
      maxCaracteres: 200,
    },
  ],

  B: [
    {
      tipo: 'busqueda',
      clave: 'perfume_referencia',
      titulo: '¿Cuál era ese perfume?',
      ayuda: 'Incluimos discontinuados en la búsqueda.',
      permiteTextoLibre: true,
      incluirDiscontinuados: true,
    },
    {
      tipo: 'texto',
      clave: 'descripcion',
      titulo: 'Describilo con tus palabras',
      placeholder: 'Era especiado y cálido, con algo dulce al fondo. Muy persistente. Lo usaba en invierno.',
      maxCaracteres: 300,
    },
    {
      tipo: 'ajustes',
      clave: 'ajustes',
      titulo: '¿Qué tan fiel querés el reemplazo?',
      sliders: [
        { clave: 'fidelidad', label: 'Fidelidad', min: 1, max: 5, izq: 'Clon exacto', der: 'Inspirado y modernizado' },
      ],
    },
    {
      tipo: 'precio',
      clave: 'presupuesto',
      titulo: 'Presupuesto',
      opciones: PRECIOS,
    },
  ],

  C: [
    {
      tipo: 'grid',
      clave: 'ocasion',
      titulo: '¿Cuál es la ocasión?',
      opciones: [
        { id: 'primera_cita', label: 'Primera cita', icono: 'sparkles' },
        { id: 'boda', label: 'Boda (invitado)', icono: 'glass' },
        { id: 'entrevista', label: 'Entrevista laboral', icono: 'briefcase' },
        { id: 'playa', label: 'Vacaciones de playa', icono: 'sun' },
        { id: 'negocios', label: 'Viaje de negocios', icono: 'plane' },
        { id: 'noche_verano', label: 'Noche de verano', icono: 'moon' },
        { id: 'cena', label: 'Cena íntima', icono: 'candle' },
        { id: 'familiar', label: 'Reunión familiar', icono: 'home' },
        { id: 'festival', label: 'Festival', icono: 'music' },
        { id: 'gym', label: 'Gym', icono: 'dumbbell' },
        { id: 'trabajo_diario', label: 'Uso diario trabajo', icono: 'coffee' },
        { id: 'noche_invierno', label: 'Noche de invierno', icono: 'snow' },
      ],
    },
    {
      tipo: 'grid',
      clave: 'genero',
      titulo: '¿Para quién?',
      opciones: [
        { id: 'M', label: 'Masculino' },
        { id: 'F', label: 'Femenino' },
        { id: 'U', label: 'Sin género' },
      ],
    },
    {
      tipo: 'grid',
      clave: 'clima',
      titulo: '¿Qué clima tenés?',
      opciones: [
        { id: 'muy_calido', label: 'Muy cálido' },
        { id: 'templado', label: 'Templado' },
        { id: 'frio', label: 'Frío' },
        { id: 'variable', label: 'Variable' },
      ],
    },
    {
      tipo: 'texto',
      clave: 'exclusiones',
      titulo: '¿Algo que no querés?',
      opcional: true,
      placeholder: 'Nada muy dulce / nada que empalague en el calor',
      maxCaracteres: 200,
    },
    {
      tipo: 'precio',
      clave: 'presupuesto',
      titulo: 'Presupuesto y moneda',
      opciones: PRECIOS,
      monedas: MONEDAS,
    },
  ],

  D: [
    {
      tipo: 'grid',
      clave: 'destinatario',
      titulo: '¿A quién?',
      opciones: [
        { id: 'pareja', label: 'Pareja' },
        { id: 'mama', label: 'Mamá' },
        { id: 'papa', label: 'Papá' },
        { id: 'amiga', label: 'Amiga' },
        { id: 'amigo', label: 'Amigo' },
        { id: 'jefe', label: 'Jefe o colega' },
        { id: 'hermana', label: 'Hermana' },
        { id: 'hermano', label: 'Hermano' },
        { id: 'abuela', label: 'Abuela' },
        { id: 'abuelo', label: 'Abuelo' },
      ],
    },
    {
      tipo: 'ajustes',
      clave: 'edad',
      titulo: '¿Cuántos años tiene?',
      sliders: [
        { clave: 'edad', label: 'Edad', min: 15, max: 70, izq: '15', der: '70+' },
      ],
    },
    {
      tipo: 'chips',
      clave: 'personalidad',
      titulo: '¿Cómo es su personalidad?',
      multiple: true,
      opciones: [
        'Clásica', 'Moderna', 'Aventurera', 'Romántica', 'Minimalista',
        'Extravagante', 'Deportiva', 'Sofisticada', 'Descontracturada',
      ],
    },
    {
      tipo: 'texto',
      clave: 'perfume_mencionado',
      titulo: '¿Sabés algún perfume que le guste o haya mencionado?',
      opcional: true,
      placeholder: 'Ej: usa Light Blue hace años / le gustó uno dulce que probó en un free shop',
      maxCaracteres: 200,
    },
    {
      tipo: 'precio',
      clave: 'presupuesto',
      titulo: '¿Cuánto querés gastar?',
      opciones: PRECIOS,
      monedas: MONEDAS,
    },
  ],
};
