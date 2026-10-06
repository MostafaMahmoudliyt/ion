import json,urllib.request,urllib.error
B='http://127.0.0.1:8787';T='tok123456789abcdef'
def call(m,p,b=None):
    r=urllib.request.Request(B+p,method=m,data=json.dumps(b).encode() if b is not None else None,headers={'Authorization':'Bearer '+T,'content-type':'application/json'})
    try:
        with urllib.request.urlopen(r) as x: t=x.read();return x.status,(json.loads(t) if t else None)
    except urllib.error.HTTPError as e:
        t=e.read();
        try:return e.code,json.loads(t)
        except:return e.code,t[:120]
ok=bad=0
def check(name,cond,info=''):
    global ok,bad
    ok+=cond;bad+=(not cond);print(('PASS ' if cond else 'FAIL ')+name,'' if cond else info)
def mk(path,b):
    s,r=call('POST',path,b);assert s in(200,201,204),(path,s,r);return r.get('id') or r.get('data',{}).get('id')
cu=mk('/api/customers',{'name':'Mona','email':'mona@x.com'})
ve=mk('/api/vendors',{'name':'ShopCo','email':'s@x.com'})
co=mk('/api/couriers',{'name':'Omar','phone':'+201000000000'})
wh=mk('/api/warehouses',{'name':'Cairo WH','city':'Cairo'})
pr=mk('/api/products',{'title':'Lamp','price':12050,'stock':5})
od=mk('/api/orders',{'reference':'ORD-1'})
oi=mk('/api/order-items',{'quantity':2,'unit_price':12050})
# complex flow
s,_=call('POST',f'/api/vendors/{ve}/vendor-productses',{'toId':pr}) ; print('link vendor-product',s,_)
s,r=call('POST',f'/api/customers/{cu}/customer-orderses',{'toId':od}); check('customer links order (fires customer.ordered + chain)',s in(200,201,204),(s,r))
s,c=call('GET',f'/api/customers/{cu}'); check('loyalty +10 via event',(c.get('loyalty_points') if 'loyalty_points' in c else c.get('data',{}).get('loyalty_points'))==10,c)
s,r=call('POST',f'/api/order-items/{oi}/line-products',{'toId':pr}); check('line.added event',s in(200,201,204),(s,r))
s,p=call('GET',f'/api/products/{pr}'); pv=p.get('data',p); check('stock 5->4, sold 0->1',(pv['stock'],pv['sold_count'])==(4,1),pv)
# state machine via chain: order.paid -> packed -> shipped
s,r=call('POST',f'/api/events/order.paid',{'actor_id':cu,'target_id':od}); check('order.paid fires',s in(200,201,204),(s,r))
s,o=call('GET',f'/api/orders/{od}'); ov=o.get('data',o); check('chain paid->packed->shipped ends shipped',ov['state']=='shipped',ov['state'])
s,r=call('POST',f'/api/events/order.delivered',{'actor_id':co,'target_id':od}); check('delivered fires',s in(200,201,204),(s,r))
s,o=call('GET',f'/api/orders/{od}'); ov=o.get('data',o); check('state delivered',ov['state']=='delivered',ov['state'])
s,c2=call('GET',f'/api/couriers/{co}'); cv=c2.get('data',c2); check('courier deliveries_done=1',cv['deliveries_done']==1,cv)
# negative paths
s,r=call('PATCH',f'/api/orders/{od}',{'state':'placed'}); check('illegal transition delivered->placed refused',s in(400,409,422),(s,r))
s,r=call('PATCH',f'/api/orders/{od}',{'state':'returned','version':ov['version']-1}); check('stale version refused (409)',s==409,(s,r))
s,r=call('POST','/api/customers',{'name':'Dup','email':'mona@x.com'}); check('unique email refused',s in(400,409,422),(s,r))
s,r=call('POST','/api/customers',{'name':'x','email':'not-an-email'}); check('invalid email refused',s in(400,422),(s,r))
s,r=call('POST','/api/events/nope.x',{'actor_id':cu,'target_id':od}); check('unknown event 404',s==404,(s,r))
s,r=call('DELETE',f'/api/customers/{cu}'); print('archive customer with orders ->',s,str(r)[:80]); check('archive customer w/ orders blocked (restrict)',s in(400,409,422),(s,r))
# processor-generated entities work at runtime
pay=mk('/api/order-payments',{'amount':241,'currency':'EGP'}); s,r=call('POST',f'/api/order-payments/{pay}/order-paymentses',{'toId':od}); print('payment link',s)
s,r=call('PATCH',f'/api/order-payments/{pay}',{'status':'refunded'}); check('payment pending->refunded refused',s in(400,409,422),(s,r))
s,r=call('PATCH',f'/api/order-payments/{pay}',{'status':'paid'}); check('payment pending->paid ok',s==200,(s,r))
s,r=call('GET','/api/customers'); 
# volume
import time;t=time.time()
for i in range(300): call('POST','/api/ops-record-01s' if False else '/api/ops-record-01s',{'title':f'r{i}'})
print('300 inserts',round(time.time()-t,2),'s')
s,l=call('GET','/api/ops-record-01s?limit=5'); print('list',s,str(l)[:100])
s,a=call('GET','/api/audit'); print('audit',s,str(a)[:100])
print(f'\n{ok} passed, {bad} failed')
