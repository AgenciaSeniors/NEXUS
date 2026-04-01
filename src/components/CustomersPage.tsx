import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { db, type Customer, type Staff, type Sale } from '../lib/db';
import { useLiveQuery } from 'dexie-react-hooks';
import { 
    UserPlus, Search, Edit2, Trash2, Users, Loader2, Phone, Mail, MapPin, 
    Star, Gift, History, X, TrendingUp, Calendar, ChevronRight
} from 'lucide-react';
import { toast } from 'sonner';
import { addToQueue, syncPush } from '../lib/sync';
import { logAuditAction } from '../lib/audit';
import { currency } from '../lib/currency';

export function CustomersPage() {
  const { currentStaff } = useOutletContext<{ currentStaff: Staff }>();
  const businessId = localStorage.getItem('nexus_business_id');

  const [searchTerm, setSearchTerm] = useState('');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [isPointsModalOpen, setIsPointsModalOpen] = useState(false);
  
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const [formData, setFormData] = useState({ name: '', phone: '', email: '', address: '' });
  const [pointsAdjustment, setPointsAdjustment] = useState({ amount: 0, reason: '' });

  // 1. PRIMERO cargamos los clientes
  const customers = useLiveQuery(async () => {
    if (!businessId) return [];
    return await db.customers
      .where('business_id').equals(businessId)
      .filter(c => !c.deleted_at)
      .reverse()
      .sortBy('created_at');
  }, [businessId]) || [];

  // 2. DESPUÉS buscamos el cliente a eliminar (ahora sí existe "customers")
  const deleteConfirmCustomer = customers.find(c => c.id === deleteConfirmId) ?? null;

  // Historial del cliente seleccionado
  const customerHistory = useLiveQuery(async (): Promise<{ sales: Sale[]; totalSpent: number; lastVisit: string | null }> => {
      if (!selectedCustomer || !businessId) return { sales: [], totalSpent: 0, lastVisit: null };

      const sales = await db.sales
        .where('business_id').equals(businessId)
        .filter(s => s.customer_id === selectedCustomer.id && s.status !== 'voided')
        .toArray();

      sales.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      const totalSpent = sales.reduce((sum, s) => sum + s.total, 0);
      const lastVisit = sales.length > 0 ? sales[0].date : null;

      return { sales, totalSpent, lastVisit };
  }, [selectedCustomer, businessId]);

  // Filtrado en cliente
  const filteredCustomers = customers.filter(c => 
    c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (c.phone && c.phone.includes(searchTerm))
  );

  // --- MANEJO DE FORMULARIO (CREAR / EDITAR) ---
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!businessId) return;
    
    setIsLoading(true);
    try {
        const cleanName = formData.name.trim();
        const cleanPhone = formData.phone.trim();
        
        if (!cleanName) {
            setIsLoading(false);
            return toast.warning("El nombre es obligatorio");
        }

        // Validación de duplicados (Teléfono único)
        if (cleanPhone) {
            const duplicate = await db.customers
                .where({ business_id: businessId })
                .filter(c => c.phone === cleanPhone && !c.deleted_at)
                .first();
            
            if (duplicate && duplicate.id !== editingId) {
                toast.warning(`El teléfono ya existe.`);
                setIsLoading(false);
                return;
            }
        }

        const customerData = {
            name: cleanName,
            phone: cleanPhone || undefined,
            email: formData.email.trim() || undefined,
            address: formData.address.trim() || undefined
        };

        // TRANSACCIÓN ATÓMICA CON SYNC
        await db.transaction('rw', [db.customers, db.action_queue, db.audit_logs], async () => {
            if (editingId) {
                // EDITAR
                const original = await db.customers.get(editingId);
                if (!original) throw new Error("Cliente no encontrado");

                const updated = { 
                    ...original, 
                    ...customerData, 
                    sync_status: 'pending_update' as const, 
                    updated_at: new Date().toISOString() 
                };

                await db.customers.put(updated);
                await addToQueue('CUSTOMER_SYNC', updated); // <--- CLAVE PARA SYNC
                await logAuditAction('UPDATE_CUSTOMER', { name: updated.name }, currentStaff);
                
                toast.success("Cliente actualizado");
            } else {
                // CREAR
                const newCustomer: Customer = {
                    id: crypto.randomUUID(),
                    business_id: businessId,
                    ...customerData,
                    loyalty_points: 0,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                    sync_status: 'pending_create' as const
                };

                await db.customers.add(newCustomer);
                await addToQueue('CUSTOMER_SYNC', newCustomer); // <--- CLAVE PARA SYNC
                await logAuditAction('CREATE_CUSTOMER', { name: newCustomer.name }, currentStaff);
                
                toast.success("Cliente registrado");
            }
        });

        setIsFormOpen(false);
        resetForm();
        syncPush().catch(console.error); // Empujar cambios a la nube

    } catch (error) {
        console.error(error);
        toast.error("Error al guardar");
    } finally {
        setIsLoading(false);
    }
  };

  // --- ELIMINAR CLIENTE ---
  const handleDelete = (id: string) => {
    setDeleteConfirmId(id);
  };

  const confirmDeleteCustomer = async () => {
    const id = deleteConfirmId;
    if (!id) return;
    setDeleteConfirmId(null);
    try {
        const customer = await db.customers.get(id);
        if (!customer) return;

        // Soft Delete: Marcamos fecha de borrado y pendiente de sync
        const deleted = { 
            ...customer, 
            deleted_at: new Date().toISOString(), 
            sync_status: 'pending_update' as const 
        };
        
        await db.transaction('rw', [db.customers, db.action_queue, db.audit_logs], async () => {
            await db.customers.put(deleted);
            await addToQueue('CUSTOMER_SYNC', deleted); // <--- CLAVE PARA SYNC
            await logAuditAction('DELETE_CUSTOMER', { name: customer.name }, currentStaff);
        });
        
        toast.success("Cliente eliminado");
        if (selectedCustomer?.id === id) setSelectedCustomer(null);
        syncPush().catch(console.error);

    } catch (e) { 
        console.error(e);
        toast.error("Error al eliminar"); 
    }
  };

  // --- AJUSTE MANUAL DE PUNTOS ---
  const handlePointsAdjustment = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!selectedCustomer || pointsAdjustment.amount === 0) return;
      if (!pointsAdjustment.reason.trim()) return toast.warning("Debes indicar un motivo");

      setIsLoading(true);
      try {
          const currentPoints = selectedCustomer.loyalty_points || 0;
          const newPoints = Math.max(0, currentPoints + pointsAdjustment.amount);

          const updatedCustomer = {
              ...selectedCustomer,
              loyalty_points: newPoints,
              sync_status: 'pending_update' as const,
              updated_at: new Date().toISOString()
          };

          await db.transaction('rw', [db.customers, db.action_queue, db.audit_logs], async () => {
              await db.customers.put(updatedCustomer);
              await addToQueue('CUSTOMER_SYNC', updatedCustomer); // <--- CLAVE PARA SYNC
              await logAuditAction('UPDATE_LOYALTY', { 
                  customer: selectedCustomer.name, 
                  adjustment: pointsAdjustment.amount, 
                  reason: pointsAdjustment.reason,
                  old_balance: currentPoints,
                  new_balance: newPoints
              }, currentStaff);
          });

          setSelectedCustomer(updatedCustomer);
          setIsPointsModalOpen(false);
          setPointsAdjustment({ amount: 0, reason: '' });
          toast.success(`Puntos actualizados: ${newPoints} pts`);
          syncPush().catch(console.error);

      } catch (error) {
          console.error(error);
          toast.error("Error al ajustar puntos");
      } finally {
          setIsLoading(false);
      }
  };

  const openEdit = (c: Customer) => {
      setEditingId(c.id);
      setFormData({ name: c.name, phone: c.phone || '', email: c.email || '', address: c.address || '' });
      setIsFormOpen(true);
  };

  const openDetails = (c: Customer) => {
      setSelectedCustomer(c);
      setIsDetailsOpen(true);
  };

  const resetForm = () => {
      setFormData({ name: '', phone: '', email: '', address: '' });
      setEditingId(null);
  };

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto pb-24">
      {/* HEADER */}
      <div className="flex flex-col sm:flex-row justify-between items-center gap-4 mb-6">
        <div>
            <h1 className="text-2xl font-bold text-[#1C1917] flex items-center gap-2">
                <Users className="text-[#EA580C]" /> Clientes
            </h1>
            <p className="text-[#78716C] text-sm">Fidelización y contactos</p>
        </div>
        
        <div className="flex w-full sm:w-auto gap-2">
            <div className="relative flex-1 sm:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#78716C] w-4 h-4" />
                <input 
                    type="text" 
                    placeholder="Buscar..." 
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#1C1917] outline-none shadow-sm text-[#1C1917]"
                />
            </div>
            <button 
                onClick={() => { resetForm(); setIsFormOpen(true); }}
                className="bg-[#EA580C] hover:bg-[#EA580C]/90 text-white px-4 py-2 rounded-xl flex items-center gap-2 font-bold shadow-lg shadow-[#EA580C]/20 transition-colors"
            >
                <UserPlus size={18} /> <span className="hidden sm:inline">Nuevo</span>
            </button>
        </div>
      </div>

      {/* LISTA DE CLIENTES */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden animate-in fade-in duration-300">
        {!customers ? (
             <div className="p-12 flex justify-center"><Loader2 className="animate-spin text-[#1C1917]"/></div>
        ) : filteredCustomers.length === 0 ? (
            <div className="p-12 text-center text-[#78716C]">
                <Users size={32} className="mx-auto mb-3 opacity-20"/>
                <p>No se encontraron clientes.</p>
            </div>
        ) : (
            <div className="overflow-x-auto">
                <table className="mobile-card-table w-full text-left">
                    <thead className="bg-[#FAFAF9] text-[#78716C] uppercase text-xs font-bold border-b border-gray-100">
                        <tr>
                            <th className="p-4">Cliente</th>
                            <th className="p-4">Contacto</th>
                            <th className="p-4 text-center">Fidelidad</th>
                            <th className="p-4 text-right">Acciones</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {filteredCustomers.map(c => (
                            <tr key={c.id} className="hover:bg-gray-50 transition-colors group cursor-pointer" onClick={() => openDetails(c)}>
                                <td className="p-4" data-label="Cliente">
                                    <div className="text-right md:text-left">
                                        <div className="font-bold text-[#1C1917]">{c.name}</div>
                                        <div className="text-xs text-[#78716C]">Desde: {new Date(c.created_at || Date.now()).toLocaleDateString()}</div>
                                    </div>
                                </td>
                                <td className="p-4 text-sm text-[#78716C]" data-label="Contacto">
                                    <div className="flex flex-col items-end md:items-start">
                                        {c.phone && <div className="flex items-center gap-2 mb-1"><Phone size={14} className="text-[#1C1917]"/> {c.phone}</div>}
                                        {c.email && <div className="flex items-center gap-2"><Mail size={14} className="text-[#1C1917]"/> {c.email}</div>}
                                    </div>
                                </td>
                                <td className="p-4 text-center" data-label="Puntos">
                                    <div className="flex justify-end md:justify-center w-full">
                                        <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold border ${c.loyalty_points && c.loyalty_points > 0 ? 'bg-[#EA580C]/10 text-[#EA580C] border-[#EA580C]/20' : 'bg-gray-50 text-gray-400 border-gray-100'}`}>
                                            <Star size={12} className={c.loyalty_points ? 'fill-current' : ''}/> {c.loyalty_points || 0}
                                        </span>
                                    </div>
                                </td>
                                <td className="p-4 text-right" data-label="Acciones" onClick={e => e.stopPropagation()}>
                                    <div className="flex justify-end gap-2 w-full">
                                        <button onClick={() => openEdit(c)} className="p-2 text-[#78716C] hover:text-[#1C1917] hover:bg-[#1C1917]/5 rounded-lg transition-colors"><Edit2 size={18}/></button>
                                        <button onClick={() => handleDelete(c.id)} className="p-2 text-[#78716C] hover:text-[#EF4444] hover:bg-[#EF4444]/10 rounded-lg transition-colors"><Trash2 size={18}/></button>
                                        <button onClick={() => openDetails(c)} className="p-2 text-[#78716C] hover:text-[#1C1917] hover:bg-gray-100 rounded-lg"><ChevronRight size={18}/></button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        )}
      </div>

      {/* --- MODAL DETALLES (CRM) --- */}
      {isDetailsOpen && selectedCustomer && (
          <div className="fixed inset-0 bg-[#1C1917]/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl h-[85vh] flex flex-col overflow-hidden">
                  
                  {/* Header del Modal */}
                  <div className="p-6 bg-[#FAFAF9] border-b border-gray-200 flex justify-between items-start">
                      <div className="flex items-center gap-4">
                          <div className="w-16 h-16 bg-[#1C1917] rounded-full flex items-center justify-center text-white font-bold text-2xl shadow-lg border-2 border-white">
                              {selectedCustomer.name.substring(0,2).toUpperCase()}
                          </div>
                          <div>
                              <h2 className="text-2xl font-bold text-[#1C1917]">{selectedCustomer.name}</h2>
                              <div className="flex gap-4 text-sm text-[#78716C] mt-1">
                                  {selectedCustomer.phone && <span className="flex items-center gap-1"><Phone size={14}/> {selectedCustomer.phone}</span>}
                                  {selectedCustomer.email && <span className="flex items-center gap-1"><Mail size={14}/> {selectedCustomer.email}</span>}
                              </div>
                              {selectedCustomer.address && <p className="text-xs text-[#78716C] mt-1 flex items-center gap-1"><MapPin size={12}/> {selectedCustomer.address}</p>}
                          </div>
                      </div>
                      <button onClick={() => setIsDetailsOpen(false)} className="p-2 hover:bg-gray-200 rounded-full text-[#78716C]"><X size={24}/></button>
                  </div>

                  {/* Contenido */}
                  <div className="flex-1 overflow-hidden flex flex-col md:flex-row">
                      
                      {/* Sidebar: Estadísticas y Puntos */}
                      <div className="w-full md:w-1/3 bg-[#FAFAF9] border-r border-gray-200 p-6 flex flex-col gap-6 overflow-y-auto">
                          
                          {/* Tarjeta de Puntos */}
                          <div className="bg-white p-5 rounded-2xl shadow-sm border border-[#F59E0B]/20 relative overflow-hidden">
                              <div className="absolute top-0 right-0 p-4 opacity-10"><Star size={100} className="text-[#F59E0B]"/></div>
                              <p className="text-[#78716C] text-xs font-bold uppercase tracking-wider">Puntos Fidelidad</p>
                              <h3 className="text-4xl font-black text-[#1C1917] mt-1">{selectedCustomer.loyalty_points || 0}</h3>
                              <button 
                                onClick={() => setIsPointsModalOpen(true)}
                                className="mt-4 w-full py-2 bg-[#1C1917] text-white text-xs font-bold rounded-xl flex items-center justify-center gap-2 hover:bg-[#1C1917]/90 transition-colors"
                              >
                                  <Gift size={14}/> Ajustar Saldo
                              </button>
                          </div>

                          {/* Estadísticas */}
                          <div className="space-y-4">
                              <div className="flex items-center gap-3 p-3 bg-white rounded-xl border border-gray-200">
                                  <div className="bg-[#EA580C]/10 p-2 rounded-lg text-[#EA580C]"><TrendingUp size={20}/></div>
                                  <div>
                                      <p className="text-[10px] text-[#78716C] font-bold uppercase">Total Gastado</p>
                                      <p className="font-bold text-[#1C1917]">{currency.format(customerHistory?.totalSpent || 0)}</p>
                                  </div>
                              </div>
                              <div className="flex items-center gap-3 p-3 bg-white rounded-xl border border-gray-200">
                                  <div className="bg-[#1C1917]/10 p-2 rounded-lg text-[#1C1917]"><Calendar size={20}/></div>
                                  <div>
                                      <p className="text-[10px] text-[#78716C] font-bold uppercase">Última Visita</p>
                                      <p className="font-bold text-[#1C1917]">{customerHistory?.lastVisit ? new Date(customerHistory.lastVisit).toLocaleDateString() : 'N/A'}</p>
                                  </div>
                              </div>
                          </div>
                      </div>

                      {/* Main: Historial de Compras */}
                      <div className="flex-1 bg-white flex flex-col min-h-0">
                          <div className="p-4 border-b border-gray-100 font-bold text-[#1C1917] flex items-center gap-2">
                              <History size={18} className="text-[#78716C]"/> Historial de Compras
                          </div>
                          <div className="flex-1 overflow-y-auto p-0">
                              {customerHistory?.sales && customerHistory.sales.length > 0 ? (
                                  <table className="w-full text-sm text-left">
                                      <thead className="bg-[#FAFAF9] text-[#78716C] uppercase text-xs sticky top-0">
                                          <tr>
                                              <th className="p-4">Fecha</th>
                                              <th className="p-4">Productos</th>
                                              <th className="p-4 text-right">Total</th>
                                          </tr>
                                      </thead>
                                      <tbody className="divide-y divide-gray-100">
                                          {customerHistory.sales.map(sale => (
                                              <tr key={sale.id} className="hover:bg-gray-50">
                                                  <td className="p-4 align-top whitespace-nowrap text-[#78716C] text-xs">
                                                      {new Date(sale.date).toLocaleDateString()} <br/>
                                                      <span className="text-[10px] opacity-70">{new Date(sale.date).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
                                                  </td>
                                                  <td className="p-4 align-top">
                                                      <ul className="space-y-1">
                                                          {sale.items.map((item, idx) => (
                                                              <li key={idx} className="text-xs text-[#1C1917]">
                                                                  <span className="font-bold">{item.quantity}x</span> {item.name}
                                                              </li>
                                                          ))}
                                                      </ul>
                                                  </td>
                                                  <td className="p-4 align-top text-right">
                                                      <span className="font-bold text-[#1C1917]">{currency.format(sale.total)}</span>
                                                      {(sale.discount_amount && sale.discount_amount > 0) ? (
                                                          <div className="text-[10px] text-amber-600 font-bold mt-0.5">Desc. -{currency.format(sale.discount_amount)}</div>
                                                      ) : null}
                                                      {(sale.redeemed_points && sale.redeemed_points > 0) ? (
                                                          <div className="text-[10px] text-indigo-600 font-bold mt-0.5">{sale.redeemed_points} pts canjeados</div>
                                                      ) : null}
                                                  </td>
                                              </tr>
                                          ))}
                                      </tbody>
                                  </table>
                              ) : (
                                  <div className="p-12 text-center text-[#78716C] italic">No hay historial de compras.</div>
                              )}
                          </div>
                      </div>
                  </div>
              </div>
          </div>
      )}

      {/* --- MODAL AJUSTE PUNTOS --- */}
      {isPointsModalOpen && selectedCustomer && (
          <div className="fixed inset-0 bg-[#1C1917]/60 z-[60] flex items-center justify-center p-4 backdrop-blur-sm">
              <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in duration-200">
                  <div className="p-5 border-b border-gray-100 bg-[#FAFAF9] text-center">
                      <h3 className="font-bold text-[#1C1917]">Ajustar Puntos</h3>
                      <p className="text-xs text-[#78716C]">Saldo actual: <span className="font-bold">{selectedCustomer.loyalty_points || 0}</span></p>
                  </div>
                  <form onSubmit={handlePointsAdjustment} className="p-6 space-y-4">
                      <div>
                          <label className="block text-xs font-bold text-[#78716C] uppercase mb-2">Cantidad a ajustar (+/-)</label>
                          <div className="flex gap-2">
                              <button type="button" onClick={() => setPointsAdjustment(p => ({...p, amount: p.amount - 10}))} className="p-2 bg-[#EF4444]/10 text-[#EF4444] rounded-lg font-bold border border-[#EF4444]/20 hover:bg-[#EF4444]/20">-10</button>
                              <input 
                                type="number" autoFocus
                                className="flex-1 text-center font-bold text-xl border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-[#1C1917]"
                                value={pointsAdjustment.amount}
                                onChange={e => setPointsAdjustment(p => ({...p, amount: parseInt(e.target.value) || 0}))}
                              />
                              <button type="button" onClick={() => setPointsAdjustment(p => ({...p, amount: p.amount + 10}))} className="p-2 bg-[#EA580C]/10 text-[#EA580C] rounded-lg font-bold border border-[#EA580C]/20 hover:bg-[#EA580C]/20">+10</button>
                          </div>
                          <p className="text-xs text-center mt-2 text-[#78716C]">
                              Nuevo saldo: <span className="font-bold text-[#1C1917]">{Math.max(0, (selectedCustomer.loyalty_points || 0) + pointsAdjustment.amount)}</span>
                          </p>
                      </div>
                      <div>
                          <label className="block text-xs font-bold text-[#78716C] uppercase mb-1">Motivo (Obligatorio)</label>
                          <input 
                            type="text" required
                            className="w-full p-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-[#1C1917]"
                            placeholder="Ej. Regalo cumpleaños, Error..."
                            value={pointsAdjustment.reason}
                            onChange={e => setPointsAdjustment(p => ({...p, reason: e.target.value}))}
                          />
                      </div>
                      <div className="flex gap-2 pt-2">
                          <button type="button" onClick={() => setIsPointsModalOpen(false)} className="flex-1 py-2 text-[#78716C] font-bold hover:bg-gray-50 rounded-lg">Cancelar</button>
                          <button type="submit" disabled={isLoading} className="flex-1 py-2 bg-[#1C1917] text-white font-bold rounded-lg hover:bg-[#1C1917]/90">
                              {isLoading ? <Loader2 className="animate-spin mx-auto"/> : 'Confirmar'}
                          </button>
                      </div>
                  </form>
              </div>
          </div>
      )}

      {/* --- MODAL FORMULARIO CLIENTE --- */}
      {isFormOpen && (
        <div className="fixed inset-0 bg-[#1C1917]/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in duration-200">
                <div className="p-6 border-b border-gray-100 bg-[#FAFAF9] flex justify-between items-center">
                    <h2 className="text-xl font-bold text-[#1C1917]">{editingId ? 'Editar Cliente' : 'Nuevo Cliente'}</h2>
                    <button onClick={() => setIsFormOpen(false)} className="text-[#78716C] hover:text-[#1C1917] text-2xl leading-none">&times;</button>
                </div>
                
                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    <div>
                        <label className="block text-xs font-bold text-[#78716C] uppercase mb-1">Nombre Completo <span className="text-[#EF4444]">*</span></label>
                        <input autoFocus required type="text" className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#1C1917] outline-none"
                            value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} placeholder="Ej. Juan Pérez" />
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-bold text-[#78716C] uppercase mb-1">Teléfono</label>
                            <input type="tel" className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#1C1917] outline-none"
                                value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} placeholder="Ej. 555-1234" />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-[#78716C] uppercase mb-1">Email</label>
                            <input type="email" className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#1C1917] outline-none"
                                value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} placeholder="juan@mail.com" />
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-[#78716C] uppercase mb-1">Dirección</label>
                        <input type="text" className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#1C1917] outline-none"
                            value={formData.address} onChange={e => setFormData({...formData, address: e.target.value})} placeholder="Calle Principal #123..." />
                    </div>
                    
                    <div className="flex gap-3 pt-4">
                        <button type="button" onClick={() => setIsFormOpen(false)} className="flex-1 py-3 bg-white border border-[#1C1917] text-[#1C1917] font-bold rounded-xl hover:bg-[#1C1917]/5 transition-colors">Cancelar</button>
                        <button type="submit" disabled={isLoading} className="flex-1 py-3 bg-[#EA580C] text-white font-bold rounded-xl hover:bg-[#EA580C]/90 flex justify-center items-center gap-2 transition-colors shadow-lg shadow-[#EA580C]/20">
                            {isLoading ? <Loader2 className="animate-spin"/> : (editingId ? 'Actualizar' : 'Guardar Cliente')}
                        </button>
                    </div>
                </form>
            </div>
        </div>
      )}

      {/* --- MODAL CONFIRMACIÓN ELIMINAR CLIENTE --- */}
      {deleteConfirmId && deleteConfirmCustomer && (
          <div className="fixed inset-0 bg-[#1C1917]/60 backdrop-blur-sm z-[70] flex items-center justify-center p-4 animate-in fade-in duration-200">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xs p-6 text-center animate-in zoom-in-95 duration-200">
                  <div className="w-14 h-14 bg-[#EF4444]/10 rounded-full flex items-center justify-center mx-auto mb-4">
                      <Trash2 size={28} className="text-[#EF4444]" />
                  </div>
                  <h3 className="font-bold text-lg text-[#1C1917] mb-1">¿Eliminar cliente?</h3>
                  <p className="text-sm text-[#78716C] mb-6">
                      Se eliminará a <span className="font-bold text-[#1C1917]">"{deleteConfirmCustomer.name}"</span> del registro.
                  </p>
                  <div className="flex gap-3">
                      <button
                          onClick={() => setDeleteConfirmId(null)}
                          className="flex-1 py-2.5 border border-gray-200 text-[#78716C] font-bold rounded-xl hover:bg-gray-50 transition-colors"
                      >
                          Cancelar
                      </button>
                      <button
                          onClick={confirmDeleteCustomer}
                          className="flex-1 py-2.5 bg-[#EF4444] text-white font-bold rounded-xl hover:bg-[#EF4444]/90 transition-colors"
                      >
                          Eliminar
                      </button>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
}