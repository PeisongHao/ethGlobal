import React, { useState ,useEffect} from "react"
import TopBar from "../../components/TopBar/TopBar";
import SideBar from "../../components/SideBar/SideBar";
import TokensGrid from "../../components/ Markterplace/TokensGrid";
import bulbasaur from "../../assets/bulbasaur.png";
import h1 from "../../assets/h1.png";

export default function Marketplace() {

  const [tokens,setTokens] = useState([]);
  const getAllCard = async ()=>{
    try{
       const formattedTokens = [
        {
            name: "Bulbasaur",
            price: 10.5,
            change: 2.1,
            image: bulbasaur,
            id: "0x3f44Bd6B6A8a2c6443ddDa37Dc6AB00752e55c4F",
            type: "pokemon",
        },
        {
            name: "Raichu",
            price: 25.0,
            change: -1.3,
            image: h1,
            id: "0x3f44Bd6B6A8a2c6443ddDa37Dc6AB00752e55c4F",
            type: "pokemon",
        },
        ];

    setTokens(formattedTokens);
    }catch(err){
        console.error('Error get the info', err);
    }
  }

  useEffect(()=>{
    getAllCard();
  },[]);
  return (
    <div className="flex flex-col h-screen bg-gradient-to-br from-gray-100 via-gray-50 to-gray-200 text-neutral-800">
      <div className="mb-2">
        <TopBar />
      </div>

      <div className="flex flex-1 gap-4 min-h-0 h-full">
        <SideBar currentPage="marketplace" />

        <TokensGrid holdings={tokens} />
      </div>
    </div>
  );
}
