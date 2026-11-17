import { useState } from 'react';

/**
 * «Ver más»: para las colas, que deben conservar su orden y por eso no se agrupan. Muestra un primer tramo de la
 * lista y un botón para pedir el siguiente. Devuelve [los elementos visibles, el botón (o null si no hace falta)].
 */
export function useVerMas(lista, paso = 8) {
  const [n, setN] = useState(paso);
  const resto = lista.length - n;
  const control = lista.length > paso ? (
    <div className="ver-mas">
      <span>Se muestran {Math.min(n, lista.length)} de {lista.length}</span>
      {resto > 0
        ? <button type="button" className="btn sec sm" onClick={() => setN((x) => x + paso)}>Ver {Math.min(paso, resto)} más</button>
        : <button type="button" className="btn ghost sm" onClick={() => setN(paso)}>Ver menos</button>}
    </div>
  ) : null;
  return [lista.slice(0, n), control];
}
