import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

interface IngresoDiaItem {
  fecha: string;
  dia_semana: string;
  ingresos: number;
}

export default function ReportesIngresosChart({ data }: { data: IngresoDiaItem[] }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="dia_semana" />
        <YAxis />
        <Tooltip formatter={(value: number | undefined) => `$${(value ?? 0).toLocaleString()}`} />
        <Legend />
        <Bar dataKey="ingresos" fill="#10b981" name="Ingresos" />
      </BarChart>
    </ResponsiveContainer>
  );
}

